// PNG 减色压缩(TinyPNG / UPNG.js 同思路),零依赖:
//  1. 统计颜色数,≤256 色时直接建调色板 —— 真正无损;
//  2. 否则对采样像素做中位切分(median cut)得到 256 色调色板,
//     再用 Floyd–Steinberg 抖动映射,肉眼几乎无差别;
//  3. 输出 8 位索引色 PNG(PLTE + tRNS),IDAT 用浏览器原生 CompressionStream 压缩。
// 照片类 PNG 一般能减 60%~80%,图标/截图类往往无损且更小。

const MAX_COLORS = 256;
const MAX_SAMPLES = 120_000;
const DITHER = 0.75;

// ---------------------------------------------------------------------------
// PNG 编码
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

// zlib 格式(RFC1950),正是 PNG IDAT 需要的。
const deflate = async (data: Uint8Array) => {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const encodeIndexedPng = async (
  width: number,
  height: number,
  indices: Uint8Array,
  palette: Uint8Array, // RGBA × n
) => {
  const count = palette.length / 4;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed color
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const plte = new Uint8Array(count * 3);
  let lastAlpha = -1;
  for (let i = 0; i < count; i++) {
    plte[i * 3] = palette[i * 4];
    plte[i * 3 + 1] = palette[i * 4 + 1];
    plte[i * 3 + 2] = palette[i * 4 + 2];
    if (palette[i * 4 + 3] !== 255) lastAlpha = i;
  }

  // 每行前置 filter 字节 0(索引色图推荐不滤波)。
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const idat = await deflate(raw);

  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
  ];
  if (lastAlpha >= 0) {
    const trns = new Uint8Array(lastAlpha + 1);
    for (let i = 0; i <= lastAlpha; i++) trns[i] = palette[i * 4 + 3];
    parts.push(chunk('tRNS', trns));
  }
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
};

// ---------------------------------------------------------------------------
// 调色板
// ---------------------------------------------------------------------------

// 颜色数 ≤256 时返回精确调色板,否则 null。
const exactPalette = (px: Uint8ClampedArray) => {
  const map = new Map<number, number>();
  const u32 = new Uint32Array(px.buffer, px.byteOffset, px.length / 4);
  for (let i = 0; i < u32.length; i++) {
    const c = u32[i];
    if (!map.has(c)) {
      if (map.size >= MAX_COLORS) return null;
      map.set(c, map.size);
    }
  }
  const palette = new Uint8Array(map.size * 4);
  const view = new Uint32Array(palette.buffer);
  map.forEach((idx, c) => {
    view[idx] = c;
  });
  const indices = new Uint8Array(u32.length);
  for (let i = 0; i < u32.length; i++) indices[i] = map.get(u32[i]);
  return { palette, indices };
};

interface Box {
  start: number;
  end: number; // [start, end)
}

// 中位切分:每次挑"颜色跨度 × 像素数"最大的盒子沿跨度最大的通道对半分。
const medianCut = (samples: Uint8Array, n: number) => {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const boxes: Box[] = [{ start: 0, end: n }];

  const rangeOf = (box: Box) => {
    const min = [255, 255, 255, 255];
    const max = [0, 0, 0, 0];
    for (let i = box.start; i < box.end; i++) {
      const o = order[i] * 4;
      for (let c = 0; c < 4; c++) {
        const val = samples[o + c];
        if (val < min[c]) min[c] = val;
        if (val > max[c]) max[c] = val;
      }
    }
    let channel = 0;
    let span = -1;
    for (let c = 0; c < 4; c++) {
      // 绿色对人眼最敏感,略加权。
      const w = c === 1 ? 1.2 : 1;
      const s = (max[c] - min[c]) * w;
      if (s > span) {
        span = s;
        channel = c;
      }
    }
    return { channel, span };
  };

  while (boxes.length < MAX_COLORS) {
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (box.end - box.start < 2) continue;
      const { channel, span } = rangeOf(box);
      const score = span * Math.sqrt(box.end - box.start);
      if (score > bestScore) {
        bestScore = score;
        best = b;
        bestChannel = channel;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const slice = Array.from(order.subarray(box.start, box.end));
    slice.sort((a, b) => samples[a * 4 + bestChannel] - samples[b * 4 + bestChannel]);
    order.set(slice, box.start);
    const mid = box.start + (slice.length >> 1);
    boxes.splice(best, 1, { start: box.start, end: mid }, { start: mid, end: box.end });
  }

  const palette = new Uint8Array(boxes.length * 4);
  boxes.forEach((box, b) => {
    const sum = [0, 0, 0, 0];
    for (let i = box.start; i < box.end; i++) {
      const o = order[i] * 4;
      for (let c = 0; c < 4; c++) sum[c] += samples[o + c];
    }
    const len = box.end - box.start || 1;
    for (let c = 0; c < 4; c++) palette[b * 4 + c] = Math.round(sum[c] / len);
  });
  return palette;
};

// 透明色排前面,tRNS 可以更短。
const sortPalette = (palette: Uint8Array) => {
  const n = palette.length / 4;
  const idx = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => palette[a * 4 + 3] - palette[b * 4 + 3],
  );
  const out = new Uint8Array(palette.length);
  idx.forEach((from, to) => out.set(palette.subarray(from * 4, from * 4 + 4), to * 4));
  return out;
};

const quantize = (px: Uint8ClampedArray, width: number, height: number) => {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const n = Math.ceil(total / step);
  const samples = new Uint8Array(n * 4);
  for (let i = 0, s = 0; i < total && s < n; i += step, s++) {
    samples.set(px.subarray(i * 4, i * 4 + 4), s * 4);
  }
  const palette = sortPalette(medianCut(samples, n));
  const count = palette.length / 4;

  // 最近色缓存:RGBA 各取高 5 位做键(1M 项,Int16)。
  const cache = new Int16Array(1 << 20).fill(-1);
  const nearest = (r: number, g: number, b: number, a: number) => {
    const key = ((r >> 3) << 15) | ((g >> 3) << 10) | ((b >> 3) << 5) | (a >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const dr = r - palette[o];
      const dg = g - palette[o + 1];
      const db = b - palette[o + 2];
      const da = a - palette[o + 3];
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + da * da;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };

  // Floyd–Steinberg 抖动,误差只保留两行。
  const indices = new Uint8Array(total);
  let cur = new Float32Array((width + 2) * 4);
  let next = new Float32Array((width + 2) * 4);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const e = (x + 1) * 4;
      const r = clamp(px[o] + cur[e]);
      const g = clamp(px[o + 1] + cur[e + 1]);
      const b = clamp(px[o + 2] + cur[e + 2]);
      const a = clamp(px[o + 3] + cur[e + 3]);
      const idx = nearest(r | 0, g | 0, b | 0, a | 0);
      indices[i] = idx;
      // 全透明像素不扩散误差,避免边缘出噪点。
      if (a === 0) continue;
      const p = idx * 4;
      for (let c = 0; c < 4; c++) {
        const v = ((c === 0 ? r : c === 1 ? g : c === 2 ? b : a) - palette[p + c]) * DITHER;
        cur[e + 4 + c] += (v * 7) / 16;
        next[e - 4 + c] += (v * 3) / 16;
        next[e + c] += (v * 5) / 16;
        next[e + 4 + c] += v / 16;
      }
    }
    const t = cur;
    cur = next;
    next = t;
    next.fill(0);
  }
  return { palette, indices };
};

// 输入 canvas,输出减色 PNG。
export const quantizePng = async (canvas: HTMLCanvasElement) => {
  const { width, height } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const exact = exactPalette(px);
  const { palette, indices } = exact
    ? { palette: sortExact(exact.palette, exact.indices), indices: exact.indices }
    : quantize(px, width, height);
  return encodeIndexedPng(width, height, indices, palette);
};

// 精确调色板同样把透明色排前面,并重写索引。
const sortExact = (palette: Uint8Array, indices: Uint8Array) => {
  const n = palette.length / 4;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => palette[a * 4 + 3] - palette[b * 4 + 3],
  );
  const remap = new Uint8Array(n);
  const out = new Uint8Array(palette.length);
  order.forEach((from, to) => {
    remap[from] = to;
    out.set(palette.subarray(from * 4, from * 4 + 4), to * 4);
  });
  for (let i = 0; i < indices.length; i++) indices[i] = remap[indices[i]];
  return out;
};
