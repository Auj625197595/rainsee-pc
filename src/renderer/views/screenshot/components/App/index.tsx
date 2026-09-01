import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Circle,
  FloppyDisk,
  GridFour,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Rectangle,
  TextT,
  X,
} from '@phosphor-icons/react';

import {
  Root,
  CaptureSurface,
  Snapshot,
  Dim,
  Selection,
  ResizeHandle,
  AnnotationCanvas,
  TextAnnotationTarget,
  Toolbar,
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
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

let textMetricsCanvas: HTMLCanvasElement | null = null;
const getTextMetrics = (text: string, size: number) => {
  const fontSize = size * 5;
  textMetricsCanvas = textMetricsCanvas || document.createElement('canvas');
  const ctx = textMetricsCanvas.getContext('2d');
  if (!ctx) return { width: Math.max(8, text.length * fontSize), height: 20 };
  ctx.font = `600 ${fontSize}px sans-serif`;
  return {
    width: Math.max(8, Math.ceil(ctx.measureText(text).width)),
    height: Math.max(16, Math.ceil(fontSize * 1.25)),
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
      ctx.font = `600 ${
        annotation.size * 5 * Math.max(scaleX, scaleY)
      }px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(annotation.text, p.x, p.y);
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
  const [movingTextIndex, setMovingTextIndex] = React.useState<number | null>(
    null,
  );
  const dragStart = React.useRef<Point | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textEditorRef = React.useRef<HTMLInputElement | null>(null);
  const textPointRef = React.useRef<Point | null>(null);
  const textValueRef = React.useRef('');
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
  } | null>(null);

  const close = React.useCallback(() => store.hide(), []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') close();
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
    textPointRef.current = null;
    textValueRef.current = '';
    setMovingTextIndex(null);
    dragStart.current = null;
    resizeState.current = null;
    textMoveState.current = null;
  }, [store.visible, store.snapshot]);

  React.useEffect(() => {
    if (!textPoint) return;
    textEditorRef.current?.focus();
  }, [textPoint]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect || !store.snapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = Math.max(1, Math.round(rect.w));
    canvas.height = Math.max(1, Math.round(rect.h));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let canceled = false;
    loadImage(store.snapshot)
      .then((image) => {
        if (canceled || !canvasRef.current || canvasRef.current !== canvas) {
          return;
        }
        const base = document.createElement('canvas');
        base.width = canvas.width;
        base.height = canvas.height;
        base
          .getContext('2d')
          ?.drawImage(
            image,
            (rect.x * image.naturalWidth) / window.innerWidth,
            (rect.y * image.naturalHeight) / window.innerHeight,
            (rect.w * image.naturalWidth) / window.innerWidth,
            (rect.h * image.naturalHeight) / window.innerHeight,
            0,
            0,
            base.width,
            base.height,
          );
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawAnnotations(
          ctx,
          draft ? [...annotations, draft] : annotations,
          base,
        );
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [rect, annotations, draft, store.snapshot]);

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

  const openTextEditor = (point: Point) => {
    setTool('text');
    setDraft(null);
    textPointRef.current = point;
    textValueRef.current = '';
    setTextPoint(point);
    setTextValue('');
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
    textPointRef.current = null;
    textValueRef.current = '';
    if (point && value) {
      setAnnotations((items) => [
        ...items,
        { kind: 'text', point, text: value, color, size },
      ]);
    }
    setTextPoint(null);
    setTextValue('');
  };

  const commitTextOnOutsidePointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.target === textEditorRef.current) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[data-selection-resize]')
    ) {
      return;
    }
    commitText();
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
    };
    setMovingTextIndex(index);
  };

  const onTextMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = textMoveState.current;
    if (!state || !rect) return;
    const nextPoint = {
      x: Math.max(
        0,
        Math.min(
          rect.w - Math.min(rect.w, state.width),
          state.point.x + event.clientX - state.start.x,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          rect.h - Math.min(rect.h, state.height),
          state.point.y + event.clientY - state.start.y,
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

  const onTextMoveUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!textMoveState.current) return;
    textMoveState.current = null;
    setMovingTextIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
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

    let initialAnnotations = annotations;
    const pendingPoint = textPointRef.current;
    const pendingValue = textValueRef.current.trim();
    if (pendingPoint && pendingValue) {
      initialAnnotations = [
        ...annotations,
        {
          kind: 'text',
          point: pendingPoint,
          text: pendingValue,
          color,
          size,
        },
      ];
      setAnnotations(initialAnnotations);
    }
    setTextPoint(null);
    setTextValue('');
    textPointRef.current = null;
    textValueRef.current = '';
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
    if (!rect || !store.snapshot) return '';
    const image = await loadImage(store.snapshot);
    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;
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

  const finish = async (action: 'copy' | 'save' | 'search') => {
    try {
      const dataURL = await exportSelection();
      if (!dataURL) return;
      if (action === 'copy') store.copy(dataURL);
      if (action === 'save') store.save(dataURL);
      if (action === 'search') store.searchImage(dataURL);
      if (action === 'copy' || action === 'save') close();
    } catch {
      store.setHint(t('shotProcessFailed'));
    }
  };

  const toolbarPosition = () => {
    if (!rect) return { left: 8, top: 64 };
    const width = Math.min(560, window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(rect.x + rect.w - width, window.innerWidth - width - 8),
    );
    let top = rect.y + rect.h + 8;
    if (top + 48 > window.innerHeight - 8) top = rect.y - 56;
    if (top < 58) top = 58;
    return { left, top };
  };

  const tools: Array<{ id: Tool; title: string; icon: React.ReactNode }> = [
    { id: 'rectangle', title: 'shotToolRectangle', icon: <Rectangle size={19} /> },
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
      style={toolbarPosition()}
      onPointerDown={(event) => event.stopPropagation()}
    >
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
      <ToolDivider />
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
        onClick={() => setAnnotations((items) => items.slice(0, -1))}
      >
        <ArrowCounterClockwise size={19} />
      </ToolIconButton>
      <ToolDivider />
      <ToolIconButton
        type="button"
        title={t('shotSearchImageTitle')}
        aria-label={t('shotSearchImageTitle')}
        onClick={() => void finish('search')}
      >
        <MagnifyingGlass size={19} />
      </ToolIconButton>
      <ToolDivider />
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
    </Toolbar>
  );

  const renderIdle = () => (
    <Root onPointerDownCapture={commitTextOnOutsidePointer}>
      {store.snapshot ? (
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
            if (annotation.kind !== 'text') return null;
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
                onPointerUp={onTextMoveUp}
                onPointerCancel={onTextMoveUp}
              />
            );
          })
        : null}
      {textPoint && rect ? (
        <TextEditor
          ref={textEditorRef}
          autoFocus
          style={{
            left: Math.min(rect.x + textPoint.x, window.innerWidth - 188),
            top: Math.min(rect.y + textPoint.y, window.innerHeight - 40),
            color,
            fontSize: Math.max(14, size * 5),
          }}
          value={textValue}
          onChange={(event) => {
            textValueRef.current = event.target.value;
            setTextValue(event.target.value);
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation();
              commitText();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              textPointRef.current = null;
              textValueRef.current = '';
              setTextPoint(null);
              setTextValue('');
            }
          }}
        />
      ) : null}
      <TopBar>
        {store.source === 'desktop'
          ? t('shotAppName')
          : t('shotDragHint')}
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
