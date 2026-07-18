import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  Root,
  CaptureSurface,
  Snapshot,
  Dim,
  Selection,
  Toolbar,
  ToolButton,
  ToolDivider,
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 把快照按选区(CSS 坐标)裁剪为 PNG dataURL。
// 快照与浮层 1:1 对齐;img 自然尺寸为物理像素,需按比例换算。
const cropSnapshot = (
  snapshot: string,
  rect: Rect,
  overlayW: number,
  overlayH: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = img.naturalWidth / overlayW;
      const sy = img.naturalHeight / overlayH;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(rect.w * sx));
      canvas.height = Math.max(1, Math.round(rect.h * sy));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no_ctx'));
      ctx.drawImage(
        img,
        rect.x * sx,
        rect.y * sy,
        rect.w * sx,
        rect.h * sy,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = snapshot;
  });

const IconLong = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
);

const IconClose = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const MIN_SELECTION = 8;

const getSelectionRect = (
  start: { x: number; y: number },
  end: { x: number; y: number },
): Rect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x),
  h: Math.abs(end.y - start.y),
});

export const App = observer(() => {
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [committed, setCommitted] = React.useState(false);
  const dragStart = React.useRef<{ x: number; y: number } | null>(null);

  const close = () => store.hide();

  // ESC 关闭浮层
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 每次显示重置本地交互状态
  React.useEffect(() => {
    if (store.visible) {
      setRect(null);
      setCommitted(false);
      dragStart.current = null;
    }
  }, [store.visible]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (committed || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    setRect(getSelectionRect(s, { x: e.clientX, y: e.clientY }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!s) return;

    const nextRect = getSelectionRect(s, { x: e.clientX, y: e.clientY });
    if (nextRect.w < MIN_SELECTION || nextRect.h < MIN_SELECTION) {
      setRect(null);
      return;
    }
    setRect(nextRect);
    setCommitted(true);
  };

  // 对当前选区裁剪后执行动作
  const withCrop = async (fn: (dataURL: string) => void) => {
    console.warn(
      '[ss-r] withCrop hasRect=',
      !!rect,
      'rect=',
      rect ? `${rect.w}x${rect.h}` : 'null',
      'hasSnapshot=',
      !!store.snapshot,
      'snapshot.len=',
      store.snapshot?.length,
      'viewport=',
      window.innerWidth + 'x' + window.innerHeight,
    );
    if (!rect || !store.snapshot) {
      console.warn('[ss-r] withCrop EARLY RETURN (rect/snapshot missing)');
      return;
    }
    try {
      const dataURL = await cropSnapshot(
        store.snapshot,
        rect,
        window.innerWidth,
        window.innerHeight,
      );
      console.warn('[ss-r] crop OK len=', dataURL?.length);
      fn(dataURL);
    } catch (e) {
      console.warn('[ss-r] crop FAILED:', (e as Error)?.message);
      store.setHint('处理失败');
    }
  };

  const onSave = () => {
    console.warn('[ss-r] click SAVE');
    withCrop((d) => { store.save(d); close(); });
  };
  const onCopy = () => {
    console.warn('[ss-r] click COPY');
    withCrop((d) => { store.copy(d); close(); });
  };
  // 问雨见AI:预留接口(裁剪图已就绪,后续接入)
  const onAskAI = () => {
    console.warn('[ss-r] click ASK-AI');
    withCrop(() => close());
  };

  const onLongShot = () => store.longCapture();

  // 长截图结果:保存 / 复制(已是整张图,无需裁剪),操作后关闭
  const onSaveLong = () => {
    if (store.longshot) store.save(store.longshot);
    close();
  };
  const onCopyLong = () => {
    if (store.longshot) store.copy(store.longshot);
    close();
  };
  const onAskAILong = () => close();

  const renderIdle = () => (
    <Root>
      {store.snapshot ? <Snapshot src={store.snapshot} /> : null}
      {rect ? (
        <Selection
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        />
      ) : (
        <Dim />
      )}

      <CaptureSurface
        $disabled={committed}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      <TopBar>
        拖动鼠标框选区域 · Esc 取消
        <TopBarCloseButton
          type="button"
          onClick={close}
          aria-label="关闭截图"
          title="关闭"
        >
          <IconClose />
        </TopBarCloseButton>
        <TopBarLongButton
          type="button"
          onClick={onLongShot}
          disabled={store.capturing}
        >
          <IconLong />
          {store.capturing ? '截取中…' : '截长图'}
        </TopBarLongButton>
      </TopBar>

      {committed && rect ? renderToolbar() : null}
    </Root>
  );

  // 工具条定位:选区右下方,贴边时上移/左移避免溢出
  const renderToolbar = () => {
    const TB_W = 260;
    const TB_H = 44;
    const TOP_BAR_CLEARANCE = 60;
    let left = rect.x + rect.w - TB_W;
    if (left < 8) left = Math.min(rect.x, window.innerWidth - TB_W - 8);
    let top = rect.y + rect.h + 8;
    if (top + TB_H > window.innerHeight - 8) top = rect.y - TB_H - 8;
    if (top < TOP_BAR_CLEARANCE) top = TOP_BAR_CLEARANCE;

    return (
      <Toolbar
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ToolButton type="button" onClick={onAskAI}>问雨见AI</ToolButton>
        <ToolDivider />
        <ToolButton type="button" onClick={onCopy}>复制</ToolButton>
        <ToolButton type="button" primary onClick={onSave}>
          保存
        </ToolButton>
      </Toolbar>
    );
  };

  const renderFullPage = () => (
    <FullPageRoot>
      <FullPageScroll>
        {store.longshot ? <FullPageImg src={store.longshot} /> : null}
      </FullPageScroll>
      <FullPageActions>
        <ToolButton type="button" onClick={onAskAILong}>问雨见AI</ToolButton>
        <ToolDivider />
        <ToolButton type="button" onClick={onCopyLong}>复制</ToolButton>
        <ToolButton type="button" primary onClick={onSaveLong}>
          保存
        </ToolButton>
        <ToolDivider />
        <ToolButton type="button" onClick={close}>关闭</ToolButton>
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
