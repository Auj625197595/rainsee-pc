import { observer } from 'mobx-react-lite';
import * as React from 'react';
import styled, { ThemeProvider, createGlobalStyle } from 'styled-components';
import { ipcRenderer } from 'electron';

import store from '../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { Titlebar } from './Titlebar';
import { Toolbar } from './Toolbar';
import { BookmarkBar } from './BookmarkBar';
import { HeaderWrapper } from './App/style';
import { HeaderFileDropPanel } from './HeaderFileDropPanel';
import {
  COMPACT_TAB_HEIGHT,
  DEFAULT_TAB_HEIGHT,
} from '~/constants/design';

const TRIGGER_HEIGHT = 3;
// The main-process cursor poll already debounces edge entry (~40ms). Keep
// only a small renderer-side guard so tabs become visible without a second
// perceptible pause after the hover signal arrives.
const SHOW_DELAY_MS = 20;
const HIDE_DELAY_MS = 280;
const HEIGHT_STORAGE_KEY = 'rainsee-immersive-header-height';

const logImmersiveOverlay = (...args: any[]) => {
  if (process.env.DEBUG_IMMERSIVE_HEADER === '1') {
    console.log('[immersive-header-overlay]', ...args);
  }
};

const OverlayStyle = createGlobalStyle`
  html,
  body,
  #app {
    background: var(--immersive-header-background, #ffffff) !important;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
`;

const AnimatedHeader = styled.div<{ $expanded: boolean }>`
  position: relative;
  box-sizing: border-box;
  width: 100vw;
  min-width: 100vw;
  max-width: 100vw;
  flex-shrink: 0;
  overflow: hidden;
  /* Keep the chrome mounted while collapsed. The BrowserView itself is only
     three pixels tall in this state, so this prevents tab/bookmark remounts
     and a second layout pass every time the pointer wakes the header. */
  height: ${({ $expanded }) => ($expanded ? 'auto' : `${TRIGGER_HEIGHT}px`)};
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

type OverlayPhase = 'collapsed' | 'expanded';

const OverlayShell = observer(() => {
  const headerRef = React.useRef<HTMLDivElement>(null);
  const renderCountRef = React.useRef(0);
  const [phase, setPhase] = React.useState<OverlayPhase>('collapsed');
  const hideTimerRef = React.useRef<number | null>(null);
  const showTimerRef = React.useRef<number | null>(null);
  const lastReportedHeightRef = React.useRef<number>(TRIGGER_HEIGHT);
  const hoveredRef = React.useRef(false);

  const expanded = phase === 'expanded';
  renderCountRef.current += 1;
  logImmersiveOverlay('render', {
    count: renderCountRef.current,
    phase,
    tabs: store.tabs.list.map((tab) => tab.id),
    selectedTabId: store.tabs.selectedTabId,
  });
  const stateLogRef = React.useRef({ phase, expanded });
  stateLogRef.current = { phase, expanded };

  const clearTimer = React.useCallback(
    (timerRef: React.MutableRefObject<number | null>) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const clearHideTimer = React.useCallback(() => {
    clearTimer(hideTimerRef);
  }, [clearTimer]);

  const clearShowTimer = React.useCallback(() => {
    clearTimer(showTimerRef);
  }, [clearTimer]);

  const transitionTo = React.useCallback(
    (next: OverlayPhase) => {
      logImmersiveOverlay('transition', {
        from: phase,
        to: next,
        hovered: hoveredRef.current,
      });
      setPhase(next);
    },
    [phase],
  );

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
    if (expanded && height > TRIGGER_HEIGHT) {
      try {
        window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
      } catch {
        // localStorage 不可用时仅跳过跨启动复用，当前进程仍使用主进程内存值。
      }
      ipcRenderer.send(`immersive-header-metrics-${store.windowId}`, {
        height,
      });
    }
  }, [expanded, phase]);

  const showHeader = React.useCallback(() => {
    logImmersiveOverlay('show requested', {
      phase,
      expanded,
    });
    hoveredRef.current = true;
    clearHideTimer();
    clearShowTimer();

    if (phase === 'expanded') return;

    showTimerRef.current = window.setTimeout(() => {
      if (!hoveredRef.current) return;
      logImmersiveOverlay('show timer fired', {
        phase,
      });
      transitionTo('expanded');
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

    if (phase === 'collapsed') return;

    hideTimerRef.current = window.setTimeout(() => {
      if (hoveredRef.current) return;
      if (
        store.immersiveSearchActive ||
        Object.keys(store.dialogsVisibility).some(
          (k) => store.dialogsVisibility[k],
        )
      ) {
        hideHeader();
        return;
      }

      transitionTo('collapsed');
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, expanded, phase, transitionTo]);

  React.useEffect(() => {
    logImmersiveOverlay('mounted', {
      windowId: store.windowId,
      href: window.location.href,
    });
    try {
      const storedHeight = Number(
        window.localStorage.getItem(HEIGHT_STORAGE_KEY),
      );
      if (Number.isFinite(storedHeight) && storedHeight > TRIGGER_HEIGHT) {
        ipcRenderer.send(`immersive-header-metrics-${store.windowId}`, {
          height: storedHeight,
        });
      }
    } catch {
      // 使用主进程的默认高度。
    }
    reportHeight();
  }, [reportHeight]);

  React.useLayoutEffect(() => {
    reportHeight();
  }, [
    reportHeight,
    expanded,
    store.settings.object.topBarVariant,
    store.settings.object.bookmarksBarDisplay,
    store.tabs.selectedTab?.url,
    store.settings.object.bookmarksBarRows,
    store.settings.object.topTabRows,
    store.tabs.topTabRowsUsed,
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
      lastReportedHeightRef.current = TRIGGER_HEIGHT;
      ipcRenderer.send(
        `immersive-header-height-${store.windowId}`,
        TRIGGER_HEIGHT,
      );
    },
    [clearHideTimer, clearShowTimer],
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
  const anyDialogVisible =
    store.immersiveSearchActive ||
    Object.keys(store.dialogsVisibility).some(
      (k) => store.dialogsVisibility[k],
    );
  React.useEffect(() => {
    if (!anyDialogVisible && !hoveredRef.current && expanded) {
      hideHeader();
    }
  }, [anyDialogVisible, expanded, hideHeader]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <AnimatedHeader ref={headerRef} $expanded={expanded}>
        <HeaderWrapper>
          <Titlebar />
          {store.settings.object.topBarVariant === 'default' && <Toolbar />}
        </HeaderWrapper>
        <BookmarkBar />
        <HeaderFileDropPanel
          targetRef={headerRef}
          windowId={store.windowId}
        />
      </AnimatedHeader>
    </div>
  );
});

const ImmersiveHeaderOverlay = observer(() => {
  const backgroundColor = store.theme['titlebar.backgroundColor'] || '#ffffff';
  const titlebarBaseHeight = store.titlebarBaseHeight;
  const tabRowPitch = store.tabs.tabRowPitch;
  const titlebarHeight =
    titlebarBaseHeight + (store.tabs.topTabRowsUsed - 1) * tabRowPitch;
  const tabSurfaceHeight = store.tabSurfaceHeight;

  React.useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      '--immersive-header-background',
      backgroundColor,
    );
    ipcRenderer.send(`immersive-header-metrics-${store.windowId}`, {
      backgroundColor,
    });
  }, [backgroundColor]);

  return (
    <ThemeProvider
      theme={{
        ...store.theme,
        animations: store.settings.object.animations,
        isCompact: store.isCompact,
        sidebarWidth: store.settings.object.sidebarWidth || 240,
        titlebarHeight,
        titlebarBaseHeight,
        tabRowPitch,
        tabSlotHeight: titlebarBaseHeight,
        tabSurfaceHeight,
        tabHitExtendTop: store.isMaximized || store.isFullscreen,
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
