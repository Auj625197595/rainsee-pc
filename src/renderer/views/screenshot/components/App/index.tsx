import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Check,
  Circle,
  FloppyDisk,
  GridFour,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Rectangle,
  Sparkle,
  TextT,
  X,
} from '@phosphor-icons/react';

import {
  Root,
  CaptureSurface,
  Snapshot,
  SnapshotCanvas,
  Dim,
  Selection,
  ResizeHandle,
  AnnotationCanvas,
  TextAnnotationTarget,
  TextEditorActions,
  TextEditorButton,
  TextEditorGroup,
  Toolbar,
  ToolbarRow,
  ToolGroup,
  ToolButton,
  ToolIconButton,
  ToolDivider,
  ColorSwatch,
  SizeInput,
  TextEditor,
  TopBar,
  TopBarCloseButton,
  TopBarLongButton,
  Hint,
  FullPageRoot,
  FullPageScroll,
  FullPageImg,
  FullPageActions,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

interface Point {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Tool =
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'mosaic';
type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

type Annotation =
  | {
      kind: 'rectangle' | 'ellipse' | 'arrow' | 'line';
      start: Point;
      end: Point;
      color: string;
      size: number;
    }
  | { kind: 'pen' | 'mosaic'; points: Point[]; color: string; size: number }
  | { kind: 'text'; point: Point; text: string; color: string; size: number };

const MIN_SELECTION = 8;
const TEXT_HIT_PADDING = 4;
// 工具条与视口边缘、与选区之间的留白
const TOOLBAR_MARGIN = 8;
const TOOLBAR_GAP = 8;
// 首次测量前的估计尺寸(单行工具条)
const TOOLBAR_FALLBACK_SIZE = { w: 560, h: 46 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));
const RESIZE_DIRECTIONS: ResizeDirection[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
];
const BitmapSnapshot = ({
  bitmap,
  onPainted,
}: {
  bitmap: ImageBitmap;
  onPainted: () => void;
}) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    // onPainted 只在换图时触发一次
    onPainted();
  }, [bitmap]);
  return <SnapshotCanvas ref={ref} />;
};

let textMetricsCanvas: HTMLCanvasElement | null = null;
const getTextMetrics = (text: string, size: number) => {
  const fontSize = size * 5;
  const lines = text.split(/\r?\n/);
  const lineHeight = fontSize * 1.25;
  textMetricsCanvas = textMetricsCanvas || document.createElement('canvas');
  const ctx = textMetricsCanvas.getContext('2d');
  if (!ctx) {
    return {
      width: Math.max(8, ...lines.map((line) => line.length * fontSize)),
      height: Math.max(16, Math.ceil(lines.length * lineHeight)),
    };
  }
  ctx.font = `600 ${fontSize}px sans-serif`;
  return {
    width: Math.max(
      8,
      ...lines.map((line) => Math.ceil(ctx.measureText(line).width)),
    ),
    height: Math.max(16, Math.ceil(lines.length * lineHeight)),
  };
};

const getSelectionRect = (start: Point, end: Point): Rect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x),
  h: Math.abs(end.y - start.y),
});

const shiftAnnotations = (
  annotations: Annotation[],
  deltaX: number,
  deltaY: number,
): Annotation[] =>
  annotations.map((annotation) => {
    const shift = (point: Point) => ({
      x: point.x + deltaX,
      y: point.y + deltaY,
    });
    if (annotation.kind === 'text') {
      return { ...annotation, point: shift(annotation.point) };
    }
    if (annotation.kind === 'pen' || annotation.kind === 'mosaic') {
      return { ...annotation, points: annotation.points.map(shift) };
    }
    return {
      ...annotation,
      start: shift(annotation.start),
      end: shift(annotation.end),
    };
  });

const resizeRect = (
  direction: ResizeDirection,
  initial: Rect,
  point: Point,
): Rect => {
  const right = initial.x + initial.w;
  const bottom = initial.y + initial.h;
  let x = initial.x;
  let y = initial.y;
  let nextRight = right;
  let nextBottom = bottom;

  if (direction.includes('w')) {
    x = Math.max(0, Math.min(point.x, right - MIN_SELECTION));
  }
  if (direction.includes('e')) {
    nextRight = Math.min(
      window.innerWidth,
      Math.max(point.x, initial.x + MIN_SELECTION),
    );
  }
  if (direction.includes('n')) {
    y = Math.max(0, Math.min(point.y, bottom - MIN_SELECTION));
  }
  if (direction.includes('s')) {
    nextBottom = Math.min(
      window.innerHeight,
      Math.max(point.y, initial.y + MIN_SELECTION),
    );
  }
  return { x, y, w: nextRight - x, h: nextBottom - y };
};

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  size: number,
) => {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = Math.max(10, size * 4);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - head * Math.cos(angle - Math.PI / 6),
    end.y - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - head * Math.cos(angle + Math.PI / 6),
    end.y - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
};

const makePixelPattern = (
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
) => {
  const block = 10;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.ceil(width / block));
  small.height = Math.max(1, Math.ceil(height / block));
  small.getContext('2d')?.drawImage(source, 0, 0, small.width, small.height);
  const pixelated = document.createElement('canvas');
  pixelated.width = width;
  pixelated.height = height;
  const pixelCtx = pixelated.getContext('2d');
  if (!pixelCtx) return null;
  pixelCtx.imageSmoothingEnabled = false;
  pixelCtx.drawImage(small, 0, 0, width, height);
  return ctx.createPattern(pixelated, 'no-repeat');
};

const drawAnnotations = (
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  base: HTMLCanvasElement,
  scaleX = 1,
  scaleY = scaleX,
) => {
  const pattern = makePixelPattern(
    ctx,
    base,
    ctx.canvas.width,
    ctx.canvas.height,
  );
  for (const annotation of annotations) {
    ctx.save();
    const point = (p: Point) => ({ x: p.x * scaleX, y: p.y * scaleY });
    const lineSize = annotation.size * Math.max(scaleX, scaleY);
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = lineSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (annotation.kind === 'rectangle') {
      const start = point(annotation.start);
      const end = point(annotation.end);
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (annotation.kind === 'ellipse') {
      const start = point(annotation.start);
      const end = point(annotation.end);
      ctx.beginPath();
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (annotation.kind === 'arrow') {
      drawArrow(ctx, point(annotation.start), point(annotation.end), lineSize);
    } else if (annotation.kind === 'line') {
      const start = point(annotation.start);
      const end = point(annotation.end);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (annotation.kind === 'text') {
      const p = point(annotation.point);
      const fontSize = annotation.size * 5 * Math.max(scaleX, scaleY);
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      annotation.text.split(/\r?\n/).forEach((line, index) => {
        ctx.fillText(line, p.x, p.y + index * fontSize * 1.25);
      });
    } else {
      if (annotation.points.length < 1) {
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      const first = point(annotation.points[0]);
      ctx.moveTo(first.x, first.y);
      for (const raw of annotation.points.slice(1)) {
        const p = point(raw);
        ctx.lineTo(p.x, p.y);
      }
      if (annotation.points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
      if (annotation.kind === 'mosaic' && pattern) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth =
          Math.max(12, annotation.size * 5) * Math.max(scaleX, scaleY);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
};

export const App = observer(() => {
  const t = useI18n();
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [committed, setCommitted] = React.useState(false);
  const [tool, setTool] = React.useState<Tool>('rectangle');
  const [color, setColor] = React.useState('#ef4444');
  const [size, setSize] = React.useState(3);
  const [annotations, setAnnotations] = React.useState<Annotation[]>([]);
  const [draft, setDraft] = React.useState<Annotation | null>(null);
  const [textPoint, setTextPoint] = React.useState<Point | null>(null);
  const [textValue, setTextValue] = React.useState('');
  const [editingTextIndex, setEditingTextIndex] = React.useState<number | null>(
    null,
  );
  const [movingTextIndex, setMovingTextIndex] = React.useState<number | null>(
    null,
  );
  const [toolbarSize, setToolbarSize] = React.useState(TOOLBAR_FALLBACK_SIZE);
  const [, setViewportVersion] = React.useState(0);
  const dragStart = React.useRef<Point | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const topBarRef = React.useRef<HTMLDivElement | null>(null);
  const textEditorRef = React.useRef<HTMLTextAreaElement | null>(null);
  const textPointRef = React.useRef<Point | null>(null);
  const textValueRef = React.useRef('');
  const editingTextIndexRef = React.useRef<number | null>(null);
  const enterFinishRef = React.useRef<() => boolean>(() => false);
  const finishingRef = React.useRef(false);
  const resizeState = React.useRef<{
    direction: ResizeDirection;
    rect: Rect;
    annotations: Annotation[];
  } | null>(null);
  const textMoveState = React.useRef<{
    index: number;
    start: Point;
    point: Point;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);

  const close = React.useCallback(() => store.hide(), []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === 'Escape') close();
      // Enter = 点「完成」。输入框/文本标注里的回车上面已经直接 return;
      // 文本标注还开着(焦点不在输入框里)、正在拖拽、输入法组字中都不响应。
      if (
        event.key === 'Enter' &&
        !event.isComposing &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        // 焦点停在工具按钮上时,阻止回车再触发一次该按钮的点击
        if (enterFinishRef.current()) event.preventDefault();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setAnnotations((items) => items.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  React.useEffect(() => {
    if (!store.visible) return;
    setRect(null);
    setCommitted(false);
    setAnnotations([]);
    setDraft(null);
    setTextPoint(null);
    setTextValue('');
    setEditingTextIndex(null);
    textPointRef.current = null;
    textValueRef.current = '';
    editingTextIndexRef.current = null;
    setMovingTextIndex(null);
    dragStart.current = null;
    resizeState.current = null;
    textMoveState.current = null;
  }, [store.visible, store.snapshot, store.snapshotBitmap]);

  React.useEffect(() => {
    if (!textPoint) return;
    textEditorRef.current?.focus();
  }, [textPoint]);

  // 视口变化(多显示器分辨率不同、页面内浮层随窗口缩放)时重新计算工具条位置
  React.useEffect(() => {
    const onResize = () => setViewportVersion((value) => value + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 实测工具条尺寸(换行后高度会变),供 toolbarPosition 避让。绘制前同步测量,
  // 尺寸有变时立即重排,避免先按旧尺寸画出一帧越界的工具条。
  const toolbarVisible = committed && !!rect && store.mode === 'idle';
  React.useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!toolbarVisible || !el) return undefined;
    const measure = () => {
      const w = Math.ceil(el.offsetWidth);
      const h = Math.ceil(el.offsetHeight);
      setToolbarSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [toolbarVisible]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect || !store.hasSnapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = Math.max(1, Math.round(rect.w));
    canvas.height = Math.max(1, Math.round(rect.h));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let canceled = false;
    store
      .loadSnapshot()
      .then((loaded) => {
        if (
          !loaded ||
          canceled ||
          !canvasRef.current ||
          canvasRef.current !== canvas
        ) {
          return;
        }
        const { image, width, height } = loaded;
        const base = document.createElement('canvas');
        base.width = canvas.width;
        base.height = canvas.height;
        base
          .getContext('2d')
          ?.drawImage(
            image,
            (rect.x * width) / window.innerWidth,
            (rect.y * height) / window.innerHeight,
            (rect.w * width) / window.innerWidth,
            (rect.h * height) / window.innerHeight,
            0,
            0,
            base.width,
            base.height,
          );
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const visibleAnnotations = annotations.filter(
          (_, index) => index !== editingTextIndex,
        );
        drawAnnotations(
          ctx,
          draft ? [...visibleAnnotations, draft] : visibleAnnotations,
          base,
        );
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [
    rect,
    annotations,
    draft,
    editingTextIndex,
    store.snapshot,
    store.snapshotBitmap,
  ]);

  const onSelectionDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (committed || event.button !== 0) return;
    store.activateDesktopDisplay();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY };
    setRect({ x: event.clientX, y: event.clientY, w: 0, h: 0 });
  };

  const onSelectionMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current) {
      setRect(
        getSelectionRect(dragStart.current, {
          x: event.clientX,
          y: event.clientY,
        }),
      );
    }
  };

  const onSelectionUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    const next = getSelectionRect(start, {
      x: event.clientX,
      y: event.clientY,
    });
    if (next.w < MIN_SELECTION || next.h < MIN_SELECTION) {
      setRect(null);
      return;
    }
    setRect(next);
    setCommitted(true);
  };

  const localPoint = (
    target: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): Point => {
    const bounds = target.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  };

  const openTextEditor = (
    point: Point,
    editingIndex: number | null = null,
    initialValue = '',
  ) => {
    setTool('text');
    setDraft(null);
    textPointRef.current = point;
    textValueRef.current = initialValue;
    editingTextIndexRef.current = editingIndex;
    setTextPoint(point);
    setTextValue(initialValue);
    setEditingTextIndex(editingIndex);
  };

  const addStraightPenLine = (end: Point) => {
    setAnnotations((items) => {
      const previousPen = [...items]
        .reverse()
        .find((annotation) => annotation.kind === 'pen');
      if (!previousPen || previousPen.kind !== 'pen') return items;

      const start = previousPen.points[previousPen.points.length - 1];
      if (
        !start ||
        (Math.abs(end.x - start.x) < 2 && Math.abs(end.y - start.y) < 2)
      ) {
        return items;
      }

      return [...items, { kind: 'pen', points: [start, end], color, size }];
    });
  };

  const onDrawDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    if (tool === 'text') {
      event.preventDefault();
      openTextEditor(point);
      return;
    }
    if (tool === 'pen' && event.shiftKey) {
      event.preventDefault();
      addStraightPenLine(point);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'pen' || tool === 'mosaic') {
      setDraft({ kind: tool, points: [point], color, size });
    } else {
      setDraft({ kind: tool, start: point, end: point, color, size });
    }
  };

  const onDrawMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    if (draft.kind === 'pen' || draft.kind === 'mosaic') {
      setDraft({ ...draft, points: [...draft.points, point] });
    } else if (draft.kind !== 'text') {
      setDraft({ ...draft, end: point });
    }
  };

  const onDrawUp = () => {
    if (!draft) return;
    const meaningful =
      draft.kind === 'pen' || draft.kind === 'mosaic'
        ? draft.points.length > 1
        : draft.kind !== 'text' &&
          (Math.abs(draft.end.x - draft.start.x) >= 2 ||
            Math.abs(draft.end.y - draft.start.y) >= 2);
    if (meaningful) setAnnotations((items) => [...items, draft]);
    setDraft(null);
  };

  const onCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    openTextEditor(
      localPoint(event.currentTarget, event.clientX, event.clientY),
    );
  };

  const commitText = () => {
    const point = textPointRef.current;
    const value = textValueRef.current.trim();
    const editingIndex = editingTextIndexRef.current;
    textPointRef.current = null;
    textValueRef.current = '';
    editingTextIndexRef.current = null;
    if (point) {
      setAnnotations((items) => {
        if (editingIndex !== null) {
          if (!value) return items.filter((_, index) => index !== editingIndex);
          return items.map((annotation, index) =>
            index === editingIndex
              ? { kind: 'text', point, text: value, color, size }
              : annotation,
          );
        }
        return value
          ? [...items, { kind: 'text', point, text: value, color, size }]
          : items;
      });
    }
    setTextPoint(null);
    setTextValue('');
    setEditingTextIndex(null);
  };

  const cancelText = () => {
    textPointRef.current = null;
    textValueRef.current = '';
    editingTextIndexRef.current = null;
    setTextPoint(null);
    setTextValue('');
    setEditingTextIndex(null);
  };

  const onTextMoveDown = (
    index: number,
    annotation: Extract<Annotation, { kind: 'text' }>,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const metrics = getTextMetrics(annotation.text, annotation.size);
    textMoveState.current = {
      index,
      start: { x: event.clientX, y: event.clientY },
      point: annotation.point,
      width: metrics.width,
      height: metrics.height,
      moved: false,
    };
    setMovingTextIndex(index);
  };

  const onTextMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = textMoveState.current;
    if (!state || !rect) return;
    const deltaX = event.clientX - state.start.x;
    const deltaY = event.clientY - state.start.y;
    if (!state.moved && Math.hypot(deltaX, deltaY) < 3) return;
    state.moved = true;
    const nextPoint = {
      x: Math.max(
        0,
        Math.min(
          rect.w - Math.min(rect.w, state.width),
          state.point.x + deltaX,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          rect.h - Math.min(rect.h, state.height),
          state.point.y + deltaY,
        ),
      ),
    };
    setAnnotations((items) =>
      items.map((annotation, index) =>
        index === state.index && annotation.kind === 'text'
          ? { ...annotation, point: nextPoint }
          : annotation,
      ),
    );
  };

  const finishTextPointerInteraction = (
    event: React.PointerEvent<HTMLDivElement>,
    editOnClick: boolean,
  ) => {
    const state = textMoveState.current;
    if (!state) return;
    textMoveState.current = null;
    setMovingTextIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (editOnClick && !state.moved) {
      const annotation = annotations[state.index];
      if (annotation?.kind === 'text') {
        setColor(annotation.color);
        setSize(annotation.size);
        openTextEditor(annotation.point, state.index, annotation.text);
      }
    }
  };

  const onResizeDown = (
    direction: ResizeDirection,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!rect || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const initialAnnotations = annotations;
    cancelText();
    setDraft(null);
    resizeState.current = { direction, rect, annotations: initialAnnotations };
  };

  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state) return;
    const next = resizeRect(state.direction, state.rect, {
      x: event.clientX,
      y: event.clientY,
    });
    setRect(next);
    setAnnotations(
      shiftAnnotations(
        state.annotations,
        state.rect.x - next.x,
        state.rect.y - next.y,
      ),
    );
  };

  const onResizeUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    resizeState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const exportSelection = async () => {
    if (!rect) return '';
    const loaded = await store.loadSnapshot();
    if (!loaded) return '';
    const { image } = loaded;
    const scaleX = loaded.width / window.innerWidth;
    const scaleY = loaded.height / window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * scaleX));
    canvas.height = Math.max(1, Math.round(rect.h * scaleY));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_canvas_context');
    ctx.drawImage(
      image,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.w * scaleX,
      rect.h * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    base.getContext('2d')?.drawImage(canvas, 0, 0);
    drawAnnotations(ctx, annotations, base, scaleX, scaleY);
    return canvas.toDataURL('image/png');
  };

  const finish = async (action: 'copy' | 'save' | 'search' | 'ai') => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      const dataURL = await exportSelection();
      if (!dataURL) return;
      if (action === 'copy') store.copy(dataURL);
      if (action === 'save') store.save(dataURL);
      if (action === 'search') store.searchImage(dataURL);
      if (action === 'ai') store.askAI(dataURL);
      if (action === 'copy' || action === 'save') close();
    } catch {
      store.setHint(t('shotProcessFailed'));
    } finally {
      finishingRef.current = false;
    }
  };

  // 全局 keydown 只注册一次,通过 ref 拿到最新状态下的「完成」
  enterFinishRef.current = () => {
    if (!committed || !rect || store.mode !== 'idle') return false;
    if (textPointRef.current) return false;
    if (dragStart.current || resizeState.current || textMoveState.current) {
      return false;
    }
    void finish('copy');
    return true;
  };

  // 工具条按实测尺寸避让:选区下方 → 上方 → 选区内底部 → 选区内顶部,
  // 水平方向右对齐选区并夹在视口内,同时不压住顶部提示条。
  const toolbarPosition = () => {
    if (!rect) return { left: TOOLBAR_MARGIN, top: TOOLBAR_MARGIN };
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = Math.min(toolbarSize.w, viewportW - TOOLBAR_MARGIN * 2);
    const height = toolbarSize.h;
    const left = clamp(
      rect.x + rect.w - width,
      TOOLBAR_MARGIN,
      viewportW - width - TOOLBAR_MARGIN,
    );
    const topBar = topBarRef.current?.getBoundingClientRect();
    const hitsTopBar = (top: number) =>
      !!topBar &&
      left < topBar.right + TOOLBAR_GAP &&
      left + width > topBar.left - TOOLBAR_GAP &&
      top < topBar.bottom + TOOLBAR_GAP &&
      top + height > topBar.top - TOOLBAR_GAP;
    const fits = (top: number) =>
      top >= TOOLBAR_MARGIN &&
      top + height <= viewportH - TOOLBAR_MARGIN &&
      !hitsTopBar(top);

    const candidates = [
      rect.y + rect.h + TOOLBAR_GAP,
      rect.y - height - TOOLBAR_GAP,
      rect.y + rect.h - height - TOOLBAR_GAP,
      rect.y + TOOLBAR_GAP,
    ];
    const top = candidates.find(fits);
    if (top !== undefined) return { left, top };

    // 选区内外都放不下(选区极矮或视口极小):贴底,再让开提示条。
    let fallback = clamp(
      rect.y + rect.h + TOOLBAR_GAP,
      TOOLBAR_MARGIN,
      viewportH - height - TOOLBAR_MARGIN,
    );
    if (topBar && hitsTopBar(fallback)) fallback = topBar.bottom + TOOLBAR_GAP;
    return { left, top: fallback };
  };

  const tools: Array<{ id: Tool; title: string; icon: React.ReactNode }> = [
    {
      id: 'rectangle',
      title: 'shotToolRectangle',
      icon: <Rectangle size={19} />,
    },
    { id: 'ellipse', title: 'shotToolEllipse', icon: <Circle size={19} /> },
    { id: 'arrow', title: 'shotToolArrow', icon: <ArrowUpRight size={19} /> },
    { id: 'line', title: 'shotToolLine', icon: <Minus size={19} /> },
    {
      id: 'pen',
      title: 'shotToolBrush',
      icon: <PencilSimple size={19} />,
    },
    { id: 'text', title: 'shotToolText', icon: <TextT size={19} /> },
    { id: 'mosaic', title: 'shotToolMosaic', icon: <GridFour size={19} /> },
  ];

  const renderToolbar = () => (
    <Toolbar
      ref={toolbarRef}
      style={toolbarPosition()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolbarRow>
        <ToolGroup>
          {tools.map((item) => (
            <ToolIconButton
              key={item.id}
              type="button"
              title={t(item.title)}
              aria-label={t(item.title)}
              $active={tool === item.id}
              onClick={() => setTool(item.id)}
            >
              {item.icon}
            </ToolIconButton>
          ))}
        </ToolGroup>
        <ToolGroup>
          <ColorSwatch
            type="color"
            value={color}
            title={t('shotColorTitle')}
            aria-label={t('shotColorTitle')}
            onChange={(event) => setColor(event.target.value)}
          />
          <SizeInput
            type="range"
            min="1"
            max="8"
            value={size}
            title={t('shotStrokeTitle')}
            aria-label={t('shotStrokeTitle')}
            onChange={(event) => setSize(Number(event.target.value))}
          />
          <ToolIconButton
            type="button"
            title={t('shotUndoTitle')}
            aria-label={t('shotUndoAria')}
            disabled={annotations.length === 0}
            onClick={() => {
              cancelText();
              setAnnotations((items) => items.slice(0, -1));
            }}
          >
            <ArrowCounterClockwise size={19} />
          </ToolIconButton>
        </ToolGroup>
        <ToolGroup>
          <ToolIconButton
            type="button"
            title={t('shotSearchImageTitle')}
            aria-label={t('shotSearchImageTitle')}
            onClick={() => void finish('search')}
          >
            <MagnifyingGlass size={19} />
          </ToolIconButton>
          <ToolIconButton
            type="button"
            title={t('shotAskAiTitle')}
            aria-label={t('shotAskAiTitle')}
            onClick={() => void finish('ai')}
          >
            <Sparkle size={19} />
          </ToolIconButton>
        </ToolGroup>
        <ToolGroup>
          <ToolIconButton
            type="button"
            title={t('shotSaveTitle')}
            aria-label={t('shotSaveTitle')}
            onClick={() => void finish('save')}
          >
            <FloppyDisk size={19} />
          </ToolIconButton>
          <ToolIconButton
            type="button"
            title={t('shotCancelTitle')}
            aria-label={t('shotCancelTitle')}
            $danger
            onClick={close}
          >
            <X size={19} />
          </ToolIconButton>
          <ToolButton
            type="button"
            title={t('shotFinishTitle')}
            aria-label={t('shotFinishTitle')}
            primary
            onClick={() => void finish('copy')}
          >
            {t('shotFinish')}
          </ToolButton>
        </ToolGroup>
      </ToolbarRow>
    </Toolbar>
  );

  const renderIdle = () => (
    <Root>
      {store.snapshotBitmap ? (
        <BitmapSnapshot
          bitmap={store.snapshotBitmap}
          onPainted={() => store.desktopSnapshotPainted()}
        />
      ) : store.snapshot ? (
        <Snapshot
          src={store.snapshot}
          onLoad={() => store.desktopSnapshotPainted()}
        />
      ) : null}
      {rect ? (
        <Selection
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        >
          {committed
            ? RESIZE_DIRECTIONS.map((direction) => (
                <ResizeHandle
                  key={direction}
                  data-selection-resize
                  $direction={direction}
                  onPointerDown={(event) => onResizeDown(direction, event)}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeUp}
                  onPointerCancel={onResizeUp}
                />
              ))
            : null}
        </Selection>
      ) : (
        <Dim />
      )}
      <CaptureSurface
        $disabled={committed}
        onPointerDown={onSelectionDown}
        onPointerMove={onSelectionMove}
        onPointerUp={onSelectionUp}
      />
      {committed && rect ? (
        <AnnotationCanvas
          ref={canvasRef}
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          onPointerDown={onDrawDown}
          onPointerMove={onDrawMove}
          onPointerUp={onDrawUp}
          onDoubleClick={onCanvasDoubleClick}
        />
      ) : null}
      {committed && rect
        ? annotations.map((annotation, index) => {
            if (annotation.kind !== 'text' || index === editingTextIndex) {
              return null;
            }
            const metrics = getTextMetrics(annotation.text, annotation.size);
            return (
              <TextAnnotationTarget
                key={`text-${index}`}
                $active={movingTextIndex === index}
                style={{
                  left: rect.x + annotation.point.x - TEXT_HIT_PADDING,
                  top: rect.y + annotation.point.y - TEXT_HIT_PADDING,
                  width: metrics.width + TEXT_HIT_PADDING * 2,
                  height: metrics.height + TEXT_HIT_PADDING * 2,
                }}
                onPointerDown={(event) =>
                  onTextMoveDown(index, annotation, event)
                }
                onPointerMove={onTextMove}
                onPointerUp={(event) =>
                  finishTextPointerInteraction(event, true)
                }
                onPointerCancel={(event) =>
                  finishTextPointerInteraction(event, false)
                }
              />
            );
          })
        : null}
      {textPoint && rect ? (
        <TextEditorGroup
          style={{
            left: Math.max(
              8,
              Math.min(rect.x + textPoint.x, window.innerWidth - 228),
            ),
            top: Math.max(
              8,
              Math.min(rect.y + textPoint.y, window.innerHeight - 126),
            ),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <TextEditor
            ref={textEditorRef}
            autoFocus
            style={{
              color,
              fontSize: Math.max(14, size * 5),
            }}
            value={textValue}
            onChange={(event) => {
              textValueRef.current = event.target.value;
              setTextValue(event.target.value);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') cancelText();
            }}
          />
          <TextEditorActions>
            <TextEditorButton
              type="button"
              $confirm
              title={t('confirm')}
              aria-label={t('confirm')}
              onClick={commitText}
            >
              <Check size={18} weight="bold" />
            </TextEditorButton>
            <TextEditorButton
              type="button"
              title={t('cancel')}
              aria-label={t('cancel')}
              onClick={cancelText}
            >
              <X size={18} weight="bold" />
            </TextEditorButton>
          </TextEditorActions>
        </TextEditorGroup>
      ) : null}
      <TopBar ref={topBarRef}>
        {store.source === 'desktop' ? t('shotAppName') : t('shotDragHint')}
        <TopBarCloseButton
          type="button"
          onClick={close}
          aria-label={t('shotCloseAria')}
          title={t('shotClose')}
        >
          <X size={14} weight="bold" />
        </TopBarCloseButton>
        {store.source === 'page' ? (
          <TopBarLongButton
            type="button"
            onClick={() => store.longCapture()}
            disabled={store.capturing}
          >
            <Rectangle size={14} />
            {store.capturing ? t('shotCapturing') : t('shotCaptureLong')}
          </TopBarLongButton>
        ) : null}
      </TopBar>
      {committed && rect ? renderToolbar() : null}
    </Root>
  );

  const renderFullPage = () => (
    <FullPageRoot>
      <FullPageScroll>
        {store.longshot ? <FullPageImg src={store.longshot} /> : null}
      </FullPageScroll>
      <FullPageActions>
        <ToolButton
          type="button"
          onClick={() => {
            if (store.longshot) store.searchImage(store.longshot);
          }}
        >
          {t('shotSearchImage')}
        </ToolButton>
        <ToolButton
          type="button"
          onClick={() => {
            if (store.longshot) store.askAI(store.longshot);
          }}
        >
          {t('shotAskAi')}
        </ToolButton>
        <ToolDivider />
        <ToolButton
          type="button"
          onClick={() => {
            if (store.longshot) store.copy(store.longshot);
            close();
          }}
        >
          {t('shotCopy')}
        </ToolButton>
        <ToolButton
          type="button"
          primary
          onClick={() => {
            if (store.longshot) store.save(store.longshot);
            close();
          }}
        >
          {t('shotSaveTitle')}
        </ToolButton>
        <ToolDivider />
        <ToolButton type="button" onClick={close}>
          {t('shotClose')}
        </ToolButton>
      </FullPageActions>
    </FullPageRoot>
  );

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <>
        <UIStyle />
        {store.mode === 'fullpage' ? renderFullPage() : renderIdle()}
        {store.hint ? <Hint>{store.hint}</Hint> : null}
      </>
    </ThemeProvider>
  );
});
