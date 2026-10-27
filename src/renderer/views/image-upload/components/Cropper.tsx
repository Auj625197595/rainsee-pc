import * as React from 'react';
import styled from 'styled-components';
import { CropRect } from '../utils/process';

// 轻量裁剪器:图片按容器等比缩放显示,裁剪框以源图像素坐标存储。
// 支持拖动整框与 8 个手柄缩放,aspect>0 时锁定比例。

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 16;

const Wrap = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  touch-action: none;
`;

const Stage = styled.div`
  position: relative;
`;

const Img = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const Box = styled.div`
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid #fff;
  box-shadow: 0 0 0 9999px rgba(10, 14, 26, 0.55);
  cursor: move;
`;

const Grid = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(255, 255, 255, 0.35) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.35) 1px, transparent 1px);
  background-size: 33.333% 33.333%;
  background-position: -1px -1px;
`;

const Knob = styled.div`
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
`;

const SizeTag = styled.div`
  position: absolute;
  left: 0;
  top: -26px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(10, 14, 26, 0.72);
  white-space: nowrap;
  pointer-events: none;
`;

const knobPos: Record<Handle, [number, number, string]> = {
  nw: [0, 0, 'nwse-resize'],
  n: [50, 0, 'ns-resize'],
  ne: [100, 0, 'nesw-resize'],
  e: [100, 50, 'ew-resize'],
  se: [100, 100, 'nwse-resize'],
  s: [50, 100, 'ns-resize'],
  sw: [0, 100, 'nesw-resize'],
  w: [0, 50, 'ew-resize'],
  move: [0, 0, 'move'],
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// 在图片范围内放一个指定比例、尽量大的居中框。
export const fitAspect = (imgW: number, imgH: number, aspect: number): CropRect => {
  if (!aspect) return { x: 0, y: 0, width: imgW, height: imgH };
  let w = imgW;
  let h = w / aspect;
  if (h > imgH) {
    h = imgH;
    w = h * aspect;
  }
  return {
    x: Math.round((imgW - w) / 2),
    y: Math.round((imgH - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  };
};

interface Props {
  src: string;
  imgWidth: number;
  imgHeight: number;
  crop: CropRect;
  aspect: number;
  onChange: (crop: CropRect) => void;
}

export const Cropper = ({ src, imgWidth, imgHeight, crop, aspect, onChange }: Props) => {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [local, setLocal] = React.useState(crop);
  const drag = React.useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  React.useEffect(() => setLocal(crop), [crop]);

  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / imgWidth, r.height / imgHeight);
      setBox({ w: imgWidth * s, h: imgHeight * s });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imgWidth, imgHeight]);

  const scale = box.w ? box.w / imgWidth : 1;

  const compute = (handle: Handle, dx: number, dy: number, s: CropRect): CropRect => {
    if (handle === 'move') {
      return {
        ...s,
        x: clamp(s.x + dx, 0, imgWidth - s.width),
        y: clamp(s.y + dy, 0, imgHeight - s.height),
      };
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;
    if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SIZE);
    if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIZE, imgWidth);
    if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIZE);
    if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, imgHeight);

    if (aspect > 0) {
      let w = right - left;
      let h = bottom - top;
      const horizontal = handle === 'e' || handle === 'w';
      const vertical = handle === 'n' || handle === 's';
      if (horizontal) h = w / aspect;
      else if (vertical) w = h * aspect;
      else if (w / h > aspect) w = h * aspect;
      else h = w / aspect;
      // 以对侧锚点为基准回填,并约束在图片内。
      const anchorX = handle.includes('w') ? right : left;
      const anchorY = handle.includes('n') ? bottom : top;
      const maxW = handle.includes('w') ? anchorX : imgWidth - anchorX;
      const maxH = vertical || horizontal ? imgHeight : handle.includes('n') ? anchorY : imgHeight - anchorY;
      if (w > maxW) {
        w = maxW;
        h = w / aspect;
      }
      if (h > maxH) {
        h = maxH;
        w = h * aspect;
      }
      if (horizontal) {
        const cy = s.y + s.height / 2;
        top = clamp(cy - h / 2, 0, imgHeight - h);
        left = handle === 'w' ? right - w : left;
      } else if (vertical) {
        const cx = s.x + s.width / 2;
        left = clamp(cx - w / 2, 0, imgWidth - w);
        top = handle === 'n' ? bottom - h : top;
      } else {
        left = handle.includes('w') ? anchorX - w : anchorX;
        top = handle.includes('n') ? anchorY - h : anchorY;
      }
      right = left + w;
      bottom = top + h;
    }
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  };

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: local };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    setLocal(compute(d.handle, dx, dy, d.start));
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(local);
  };

  return (
    <Wrap ref={wrapRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <Stage style={{ width: box.w, height: box.h }}>
        <Img src={src} draggable={false} alt="" />
        <Box
          onPointerDown={onPointerDown('move')}
          style={{
            left: local.x * scale,
            top: local.y * scale,
            width: local.width * scale,
            height: local.height * scale,
          }}
        >
          <Grid />
          <SizeTag style={local.y * scale < 30 ? { top: 6, left: 6 } : undefined}>
            {local.width} × {local.height}
          </SizeTag>
          {HANDLES.map((h) => (
            <Knob
              key={h}
              onPointerDown={onPointerDown(h)}
              style={{
                left: `${knobPos[h][0]}%`,
                top: `${knobPos[h][1]}%`,
                cursor: knobPos[h][2],
              }}
            />
          ))}
        </Box>
      </Stage>
    </Wrap>
  );
};
