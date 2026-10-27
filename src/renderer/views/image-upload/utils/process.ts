// 图片处理:全部基于 canvas,零依赖。
//  - lossless:视觉无损(允许肉眼不可见的损失),原尺寸;JPEG/WebP q=0.8 重编码,
//    PNG 256 色减色(png-quant.ts);结果不比原图小时回退原图。
//  - target :先按最长边缩放,再二分质量逼近目标体积;质量到底仍超限则逐步缩尺寸。
//  - crop   :按裁剪框截取后输出,可叠加 target 压缩。

import { quantizePng } from './png-quant';

export type ProcessMode = 'original' | 'lossless' | 'target' | 'crop';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessOptions {
  mode: ProcessMode;
  targetKB: number;
  maxEdge: number;
  crop?: CropRect | null;
  // 裁剪后是否再压到目标大小。
  cropCompress?: boolean;
  accept: string;
}

export interface ProcessOutput {
  blob: Blob;
  type: string;
  width: number;
  height: number;
  // 达不到目标体积时为 false。
  reached: boolean;
  // 结果就是原文件(未做任何处理或处理后反而更大)。
  untouched: boolean;
}

// 视觉无损档的 JPEG/WebP 质量:0.8 在多数照片上肉眼无差别,体积通常减半以上。
const LOSSLESS_QUALITY = 0.8;
const QUALITY_MIN = 0.4;
const QUALITY_MAX = 0.95;
const MIN_EDGE = 320;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

// 解析 accept,判断某 MIME 是否被页面允许。空 accept 视为全部允许。
export const isAccepted = (accept: string, type: string) => {
  const parts = (accept || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return true;
  const ext = EXT_BY_TYPE[type];
  return parts.some((p) => {
    if (p === '*/*' || p === 'image/*') return true;
    if (p === type) return true;
    if (p.startsWith('.') && ext) {
      const e = p.slice(1);
      return e === ext || (ext === 'jpg' && (e === 'jpeg' || e === 'jfif'));
    }
    return false;
  });
};

export const renameForType = (name: string, type: string) => {
  const ext = EXT_BY_TYPE[type];
  if (!ext) return name;
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  const current = (name.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase();
  if (current === ext || (ext === 'jpg' && current === 'jpeg')) return name;
  return `${base}.${ext}`;
};

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      type,
      quality,
    );
  });

const hasAlpha = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  // 大图抽样检测,避免整幅 getImageData 卡顿。
  const step = Math.max(1, Math.floor(Math.sqrt((canvas.width * canvas.height) / 40000)));
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const stride = 4 * step;
  for (let i = 3; i < data.length; i += stride) {
    if (data[i] < 255) return true;
  }
  return false;
};

const draw = (
  bitmap: ImageBitmap,
  src: CropRect,
  width: number,
  height: number,
  fillWhite: boolean,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    bitmap,
    src.x,
    src.y,
    src.width,
    src.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
};

// 选输出格式:优先保持原格式;BMP 不是浏览器可编码格式,转 PNG/JPEG;
// 需要按体积压缩且无透明通道时,PNG 可转 JPEG(页面 accept 允许才转)。
const pickType = (
  sourceType: string,
  accept: string,
  wantLossy: boolean,
  alpha: boolean,
) => {
  const candidates: string[] = [];
  if (sourceType === 'image/jpeg' || sourceType === 'image/webp') {
    candidates.push(sourceType, 'image/jpeg', 'image/webp', 'image/png');
  } else if (wantLossy && !alpha) {
    candidates.push('image/jpeg', 'image/webp', 'image/png');
  } else if (wantLossy && alpha) {
    candidates.push('image/webp', 'image/png', 'image/jpeg');
  } else {
    candidates.push('image/png', 'image/jpeg', 'image/webp');
  }
  if (sourceType === 'image/png' && !wantLossy) candidates.unshift('image/png');
  return candidates.find((t) => isAccepted(accept, t)) || candidates[0];
};

const isLossy = (type: string) => type === 'image/jpeg' || type === 'image/webp';

// 在给定尺寸下二分质量,找出不超过 limit 的最高质量。
const fitQuality = async (
  canvas: HTMLCanvasElement,
  type: string,
  limit: number,
) => {
  let best: Blob | null = null;
  let low = QUALITY_MIN;
  let high = QUALITY_MAX;
  const top = await toBlob(canvas, type, high);
  if (top.size <= limit) return top;
  const bottom = await toBlob(canvas, type, low);
  if (bottom.size > limit) return null;
  best = bottom;
  for (let i = 0; i < 6; i++) {
    const mid = (low + high) / 2;
    const blob = await toBlob(canvas, type, mid);
    if (blob.size <= limit) {
      best = blob;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
};

export const processImage = async (
  file: Blob,
  sourceType: string,
  options: ProcessOptions,
): Promise<ProcessOutput> => {
  const bitmap = await createImageBitmap(file);
  try {
    const full: CropRect = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };

    if (options.mode === 'original') {
      return {
        blob: file,
        type: sourceType,
        width: bitmap.width,
        height: bitmap.height,
        reached: true,
        untouched: true,
      };
    }

    const src =
      options.mode === 'crop' && options.crop && options.crop.width > 0
        ? options.crop
        : full;

    const useTarget =
      options.mode === 'target' || (options.mode === 'crop' && options.cropCompress);

    let width = src.width;
    let height = src.height;
    if (useTarget && options.maxEdge > 0) {
      const scale = Math.min(1, options.maxEdge / Math.max(width, height));
      width *= scale;
      height *= scale;
    }

    const probe = draw(bitmap, src, Math.min(width, 512), Math.min(height, 512), false);
    const alpha = sourceType !== 'image/jpeg' && hasAlpha(probe);
    const type = pickType(sourceType, options.accept, useTarget, alpha);
    const fillWhite = type === 'image/jpeg';

    if (!useTarget) {
      // lossless(视觉无损)/ 单纯裁剪:保持尺寸,允许肉眼不可见的损失。
      //  - JPEG/WebP:q=0.8 重编码(Compressor.js 等通行做法),去 EXIF;
      //  - PNG:256 色减色 + 抖动(TinyPNG 思路),≤256 色的图真正无损;
      //  - BMP:无透明转 JPEG,否则走 PNG 减色。
      const losslessType =
        sourceType === 'image/bmp' && !alpha && isAccepted(options.accept, 'image/jpeg')
          ? 'image/jpeg'
          : type;
      const canvas = draw(bitmap, src, width, height, losslessType === 'image/jpeg');
      const blob = isLossy(losslessType)
        ? await toBlob(canvas, losslessType, LOSSLESS_QUALITY)
        : await quantizePng(canvas);
      if (
        options.mode === 'lossless' &&
        blob.size >= file.size &&
        isAccepted(options.accept, sourceType)
      ) {
        return {
          blob: file,
          type: sourceType,
          width: bitmap.width,
          height: bitmap.height,
          reached: true,
          untouched: true,
        };
      }
      return {
        blob,
        type: losslessType,
        width: canvas.width,
        height: canvas.height,
        reached: true,
        untouched: false,
      };
    }

    const limit = Math.max(1, options.targetKB) * 1024;

    // 原图已满足(格式未变、尺寸未变)时直接用原图,避免无谓的二次压缩。
    if (
      options.mode === 'target' &&
      file.size <= limit &&
      width === bitmap.width &&
      height === bitmap.height &&
      isAccepted(options.accept, sourceType)
    ) {
      return {
        blob: file,
        type: sourceType,
        width: bitmap.width,
        height: bitmap.height,
        reached: true,
        untouched: true,
      };
    }

    let last: { blob: Blob; w: number; h: number } | null = null;
    for (let round = 0; round < 14; round++) {
      const canvas = draw(bitmap, src, width, height, fillWhite);
      if (isLossy(type)) {
        const blob = await fitQuality(canvas, type, limit);
        if (blob) {
          return { blob, type, width: canvas.width, height: canvas.height, reached: true, untouched: false };
        }
        last = { blob: await toBlob(canvas, type, QUALITY_MIN), w: canvas.width, h: canvas.height };
      } else {
        // PNG 无法调质量:先减色(体积通常降 60%+),仍超限再缩尺寸。
        const blob = await quantizePng(canvas);
        if (blob.size <= limit) {
          return { blob, type, width: canvas.width, height: canvas.height, reached: true, untouched: false };
        }
        last = { blob, w: canvas.width, h: canvas.height };
      }
      if (Math.max(width, height) * 0.85 < MIN_EDGE) break;
      // PNG 体积约与像素数成正比,按比例估算一步到位,减少迭代。
      const ratio = isLossy(type)
        ? 0.85
        : Math.max(0.5, Math.min(0.9, Math.sqrt(limit / last.blob.size) * 0.97));
      width *= ratio;
      height *= ratio;
    }
    return {
      blob: last.blob,
      type,
      width: last.w,
      height: last.h,
      reached: last.blob.size <= limit,
      untouched: false,
    };
  } finally {
    bitmap.close();
  }
};
