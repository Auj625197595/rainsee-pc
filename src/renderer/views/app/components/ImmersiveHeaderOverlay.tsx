import { observer } from 'mobx-react-lite';
import * as React from 'react';
import styled, {
  ThemeProvider,
  createGlobalStyle,
  keyframes,
  css,
} from 'styled-components';
import { ipcRenderer } from 'electron';

import store from '../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { Titlebar } from './Titlebar';
import { Toolbar } from './Toolbar';
import { BookmarkBar } from './BookmarkBar';
import { HeaderWrapper } from './App/style';
import { HeaderFileDropPanel } from './HeaderFileDropPanel';
import {
  DEFAULT_TITLEBAR_HEIGHT,
  COMPACT_TITLEBAR_HEIGHT,
  DEFAULT_TAB_MARGIN_TOP,
  COMPACT_TAB_MARGIN_TOP,
  COMPACT_TAB_HEIGHT,
  DEFAULT_TAB_HEIGHT,
} from '~/constants/design';

const TRIGGER_HEIGHT = 3;
const SHOW_DELAY_MS = 70;
const HIDE_DELAY_MS = 280;
const ANIMATION_MS = 240;

const logImmersiveOverlay = (...args: any[]) => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_IMMERSIVE_HEADER === '1'
  ) {
    console.log('[immersive-header-overlay]', ...args);
  }
};

const OverlayStyle = createGlobalStyle`
  html,
  body,
  #app {
    background: transparent !important;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
`;

const reveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(-14px) scale(0.985);
    filter: saturate(0.94);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: saturate(1);
  }
`;

const hide = keyframes`
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: saturate(1);
  }
  to {
    opacity: 0;
    transform: translateY(-10px) scale(0.992);
    filter: saturate(0.96);
  }
`;

const AnimatedHeader = styled.div<{
  $phase: OverlayPhase;
}>`
  position: relative;
  width: 100%;
  opacity: 1;
  transform-origin: top center;
  overflow: hidden;
  box-shadow: 0 18px 36px -24px rgba(16, 24, 40, 0.42);
  will-change: transform, opacity, filter;

  ${({ $phase }) =>
    $phase === 'expanding' &&
    css`
      animation: ${reveal} ${ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
    `}

  ${({ $phase }) =>
    $phase === 'collapsing' &&
    css`
      animation: ${hide} ${ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1);
    `}
`;

const Root = createGlobalStyle`
  #app {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
`;

type OverlayPhase = 'collapsed' | 'expanding' | 'expanded' | 'collapsing';

const OverlayShell = observer(() => {
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [phase, setPhase] = React.useState<OverlayPhase>('collapsed');
  const hideTimerRef = React.useRef<number | null>(null);
  const showTimerRef = React.useRef<number | null>(null);
  const phaseTimerRef = React.useRef<number | null>(null);
  const lastReportedHeightRef = React.useRef<number>(TRIGGER_HEIGHT);
  const hoveredRef = React.useRef(false);

  const expanded = phase !== 'collapsed';
  const stateLogRef = React.useRef({ phase, expanded });
  stateLogRef.current = { phase, expanded };

  const clearTimer = React.useCallback((timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearHideTimer = React.useCallback(() => {
    clearTimer(hideTimerRef);
  }, [clearTimer]);

  const clearShowTimer = React.useCallback(() => {
    clearTimer(showTimerRef);
  }, [clearTimer]);

  const clearPhaseTimer = React.useCallback(() => {
    clearTimer(phaseTimerRef);
  }, [clearTimer]);

  const transitionTo = React.useCallback((next: OverlayPhase) => {
    clearPhaseTimer();
    logImmersiveOverlay('transition', {
      from: phase,
      to: next,
      hovered: hoveredRef.current,
    });
    setPhase(next);

    if (next === 'expanding') {
      phaseTimerRef.current = window.setTimeout(() => {
        setPhase((current) => (current === 'expanding' ? 'expanded' : current));
      }, ANIMATION_MS);
      return;
    }

    if (next === 'collapsing') {
      phaseTimerRef.current = window.setTimeout(() => {
        if (hoveredRef.current) {
          transitionTo('expanding');
          return;
        }
        setPhase((current) => (current === 'collapsing' ? 'collapsed' : current));
      }, ANIMATION_MS);
    }
  }, [clearPhaseTimer]);

  const reportHeight = React.useCallback(() => {
    const height = expanded
      ? Math.max(
          TRIGGER_HEIGHT,
          Math.ceil(
            headerRef.current?.getBoundingClientRect().height || TRIGGER_HEIGHT,
          ),
        )
      : TRIGGER_HEIGHT;

    if (lastReportedHeightRef.current === height) return;
    lastReportedHeightRef.current = height;
    logImmersiveOverlay('report height', {
      height,
      expanded,
      phase,
      rectHeight: headerRef.current?.getBoundingClientRect().height || null,
      windowId: store.windowId,
    });
    ipcRenderer.send(`immersive-header-height-${store.windowId}`, height);
  }, [expanded, phase]);

  const showHeader = React.useCallback(() => {
    logImmersiveOverlay('show requested', {
      phase,
      expanded,
    });
    hoveredRef.current = true;
    clearHideTimer();
    clearShowTimer();

    if (phase === 'expanded' || phase === 'expanding') return;

    if (phase === 'collapsing') {
      transitionTo('expanding');
      return;
    }

    showTimerRef.current = window.setTimeout(() => {
      if (!hoveredRef.current) return;
      logImmersiveOverlay('show timer fired', {
        phase,
      });
      transitionTo('expanding');
    }, SHOW_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, expanded, phase, transitionTo]);

  const hideHeader = React.useCallback(() => {
    logImmersiveOverlay('hide requested', {
      phase,
      expanded,
    });
    hoveredRef.current = false;
    if (hideTimerRef.current) {
      clearHideTimer();
    }
    clearShowTimer();

    if (phase === 'collapsed' || phase === 'collapsing') return;

    hideTimerRef.current = window.setTimeout(() => {
      if (hoveredRef.current) return;
      if (Object.keys(store.dialogsVisibility).some((k) => store.dialogsVisibility[k])) {
        hideHeader();
        return;
      }

      transitionTo('collapsing');
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, expanded, phase, transitionTo]);

  React.useEffect(() => {
    logImmersiveOverlay('mounted', {
      windowId: store.windowId,
      href: window.location.href,
    });
    reportHeight();
  }, [reportHeight]);

  React.useLayoutEffect(() => {
    reportHeight();
  }, [
    reportHeight,
    expanded,
    store.settings.object.topBarVariant,
    store.settings.object.bookmarksBar,
    store.settings.object.bookmarksBarRows,
  ]);

  React.useEffect(() => {
    if (!expanded || !headerRef.current) return undefined;

    const observer = new ResizeObserver(() => {
      reportHeight();
    });

    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [expanded, reportHeight]);

  React.useEffect(
    () => () => {
      clearShowTimer();
      clearHideTimer();
      clearPhaseTimer();
      lastReportedHeightRef.current = TRIGGER_HEIGHT;
      ipcRenderer.send(`immersive-header-height-${store.windowId}`, TRIGGER_HEIGHT);
    },
    [clearHideTimer, clearPhaseTimer, clearShowTimer],
  );

  // 悬停信号改由主进程游标轮询下发(替换 DOM mouseenter/leave):透明置顶窗在
  // resize 时会反馈幽灵 mouse 事件驱动显隐状态机,导致偶发闪烁。用 ref 取 always-latest
  // 的 show/hide,IPC 监听器只注册一次,避免 phase 变化时反复解绑/绑定。
  const showHeaderRef = React.useRef(showHeader);
  showHeaderRef.current = showHeader;
  const hideHeaderRef = React.useRef(hideHeader);
  hideHeaderRef.current = hideHeader;

  React.useEffect(() => {
    const onHover = (_e: Electron.IpcRendererEvent, hovered: boolean) => {
      const current = stateLogRef.current;
      logImmersiveOverlay('ipc hover', {
        hovered,
        phase: current.phase,
        expanded: current.expanded,
      });
      if (hovered) showHeaderRef.current();
      else hideHeaderRef.current();
    };
    logImmersiveOverlay('listen hover');
    ipcRenderer.on('immersive-header-hover', onHover);
    return () => {
      logImmersiveOverlay('unlisten hover');
      ipcRenderer.removeListener('immersive-header-hover', onHover);
    };
  }, []);

  // 弹窗全部关闭且游标已不在头部时收起。主进程只在悬停态「变化」时发信号,若游标
  // 早已离开、仅剩弹窗撑着不收,弹窗关闭这一刻不会再有 hover=false 到达,这里补上。
  const anyDialogVisible = Object.keys(store.dialogsVisibility).some(
    (k) => store.dialogsVisibility[k],
  );
  React.useEffect(() => {
    if (!anyDialogVisible && !hoveredRef.current && expanded) {
      hideHeader();
    }
  }, [anyDialogVisible, expanded, hideHeader]);

  return (
    <div
      style={{ width: '100%', height: '100%' }}
    >
      {expanded ? (
        <AnimatedHeader
          ref={headerRef}
          $phase={phase}
        >
          <HeaderWrapper>
            <Titlebar />
            {store.settings.object.topBarVariant === 'default' && <Toolbar />}
          </HeaderWrapper>
          <BookmarkBar />
          <HeaderFileDropPanel targetRef={headerRef} windowId={store.windowId} />
        </AnimatedHeader>
      ) : null}
    </div>
  );
});

const ImmersiveHeaderOverlay = observer(() => {
  return (
    <ThemeProvider
      theme={{
        ...store.theme,
        animations: store.settings.object.animations,
        isCompact: store.isCompact,
        sidebarWidth: store.settings.object.sidebarWidth || 240,
        titlebarHeight: !store.isCompact
          ? DEFAULT_TITLEBAR_HEIGHT
          : COMPACT_TITLEBAR_HEIGHT,
        tabMarginTop: !store.isCompact
          ? DEFAULT_TAB_MARGIN_TOP
          : COMPACT_TAB_MARGIN_TOP,
        tabHeight: store.isCompact ? COMPACT_TAB_HEIGHT : DEFAULT_TAB_HEIGHT,
      }}
    >
      <UIStyle />
      <OverlayStyle />
      <Root />
      <OverlayShell />
    </ThemeProvider>
  );
});

export default ImmersiveHeaderOverlay;
