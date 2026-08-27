import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ThemeProvider } from 'styled-components';
import { ipcRenderer } from 'electron';
import { platform } from 'os';

import {
  StyledApp,
  SidebarShell,
  SidebarTopDrag,
  SidebarBody,
  ContentColumn,
  ViewAnchor,
  HeaderWrapper,
  TopChrome,
  AppToastStack,
  ProfileOnboardingToast,
  ProfileOnboardingAction,
} from './style';
import { Titlebar } from '../Titlebar';
import { Toolbar } from '../Toolbar';
import { Sidebar } from '../Sidebar';
import ClearExitOverlay from '../ClearExitOverlay';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { BookmarkBar } from '../BookmarkBar';
import { HeaderFileDropPanel } from '../HeaderFileDropPanel';
import {
  DEFAULT_TITLEBAR_HEIGHT,
  COMPACT_TITLEBAR_HEIGHT,
  DEFAULT_TAB_MARGIN_TOP,
  COMPACT_TAB_MARGIN_TOP,
  COMPACT_TAB_HEIGHT,
  DEFAULT_TAB_HEIGHT,
} from '~/constants/design';
import { ISettings } from '~/interfaces';
import { getTheme } from '~/utils/themes';
import {mergeChromeTheme} from '~/common/chrome-theme';
import {
  buildChromePanelCss,
  sanitizeChromePanelValues,
  IChromePanelValues,
} from '~/common/chrome-style-panel';

const syncStartupShellTheme = (settings: Partial<ISettings>) => {
  const dark = store.isIncognito || settings.theme === 'wexond-dark';
  const base = getTheme(
    !store.isIncognito && settings.activeChromeTheme
      ? 'wexond-light'
      : dark
      ? 'wexond-dark'
      : 'wexond-light',
  );
  const bg = store.isIncognito
    ? base['titlebar.backgroundColor']
    : mergeChromeTheme(base, settings.activeChromeTheme)['titlebar.backgroundColor'];
  document.documentElement.style.backgroundColor = bg;
  (document.documentElement.style as any).colorScheme = dark ? 'dark' : 'light';
  document.body.style.backgroundColor = bg;
  const app = document.getElementById('app');
  if (app) {
    app.style.backgroundColor = bg;
  }
};

const cssImage = (value: string | undefined) =>
  value ? `url("${value.replace(/"/g, '%22')}")` : 'none';

const ChromeExtensionThemeStyle = observer(() => {
  if (store.isIncognito) return null;
  const theme = store.settings.object.activeChromeTheme;
  if (!theme) return null;
  const frameImage = theme.images.theme_frame;
  const frameOverlay = theme.images.theme_frame_overlay;
  const toolbarImage = theme.images.theme_toolbar;
  const tabImage = theme.images.theme_tab_background;

  return (
    <style data-rainsee-extension-theme>{`
      [data-rainsee-part="titlebar"] {
        background-image: ${[frameOverlay, frameImage]
          .filter(Boolean)
          .map(cssImage)
          .join(', ') || 'none'};
        background-position: top left;
        /* Keep the frame artwork proportional while filling the full titlebar. */
        background-size: auto 100%;
        background-repeat: repeat-x;
      }
      [data-rainsee-part="toolbar"] {
        background-image: ${cssImage(toolbarImage)};
        background-position: top left;
        background-repeat: repeat-x;
      }
      [data-rainsee-part="tab"][data-rainsee-selected="false"]
        > [data-rainsee-part="tab-surface"] {
        background-image: ${cssImage(tabImage)};
        background-position: top left;
        background-repeat: repeat;
      }
      [data-rainsee-part="tab"][data-rainsee-selected="true"]
        > [data-rainsee-part="tab-surface"] {
        background-image: ${cssImage(toolbarImage)};
        background-position: top left;
        background-repeat: repeat-x;
      }
      [data-rainsee-part="bookmark-bar"] {
        background-color: ${store.theme['toolbar.backgroundColor']};
        background-image: ${cssImage(toolbarImage)};
        background-position: top left;
        background-repeat: repeat-x;
      }
      [data-rainsee-part="tab-bar"] [data-rainsee-action="new-tab"] {
        background-color: ${store.theme['tab.backgroundColor'] || 'transparent'};
        background-image: ${cssImage(tabImage)};
        background-position: top left;
        background-repeat: repeat;
      }
    `}</style>
  );
});

const ChromeUserStyle = observer(() => {
  const customCss = store.settings.object.customChromeCss;

  return typeof customCss === 'string' && customCss.trim() ? (
    <style data-rainsee-user-css>{`
      @scope (
        [data-rainsee-area="sidebar"],
        [data-rainsee-area="topbar"]
      ) {
        ${customCss}
      }
    `}</style>
  ) : null;
});

// 「可视化调控面板」生成的 CSS。与手写 CSS 同一个 @scope 管道,但渲染在
// data-rainsee-user-css 之前 —— 手写规则靠源顺序胜出,两者可叠加。
// live 通道:设置页拖动滑条时高频推送,立即覆盖持久化值实时预览。
// 预览更新不走 React state(<style> 换内容会触发 React 重渲染 + CSSOM 全量
// 重建),而是用独立 adopted stylesheet 原位 replaceSync —— 只重解析一小段
// 规则文本,顶部栏样式重算量最小,拖动不掉帧。
const panelStyleSheet = (() => {
  try {
    const sheet = new CSSStyleSheet();
    (document as any).adoptedStyleSheets = [
      ...(document as any).adoptedStyleSheets,
      sheet,
    ];
    return sheet;
  } catch {
    // 老 Chromium 不支持 adoptedStyleSheets 时退回 <style> 元素。
    return null;
  }
})();
// replaceSync 失败时置 null,applyChromePanelCss 会切换到 fallback 元素。
let panelStyleSheetLive = panelStyleSheet;

let panelStyleFallbackElement: HTMLStyleElement | null = null;

const ensurePanelStyleFallback = () => {
  if (!panelStyleFallbackElement) {
    const el = document.createElement('style');
    el.setAttribute('data-rainsee-panel-css', '');
    document.head.appendChild(el);
    panelStyleFallbackElement = el;
  }
  return panelStyleFallbackElement;
};

const applyChromePanelCss = (cssText: string) => {
  const wrapped = `@scope (
    [data-rainsee-area="sidebar"],
    [data-rainsee-area="topbar"]
  ) {
    ${cssText}
  }`;
  if (panelStyleSheetLive) {
    try {
      panelStyleSheetLive.replaceSync(wrapped);
      return;
    } catch {
      // replaceSync 不接受(@scope 等特性缺失/非法 CSS)→ 永久切换到
      // <style> 元素路径,后续不再尝试。
      try {
        (document as any).adoptedStyleSheets = (
          document as any
        ).adoptedStyleSheets.filter((s: any) => s !== panelStyleSheetLive);
      } catch {
        // 移除失败也无妨,sheet 内容保持空。
      }
      panelStyleSheetLive = null;
    }
  }
  ensurePanelStyleFallback().textContent = wrapped;
};

const ChromePanelStyle = observer(() => {
  // 只订阅 chromeStylePanel 一个字段:mobx observer 会按实际读取的属性
  // 建立依赖,读 object.chromeStylePanel 而非先取整个 object 引用,
  // update-settings 全量替换 settings.object 时若面板值内容相同则不重渲染。
  const saved = store.settings.object.chromeStylePanel;
  const lastCssRef = React.useRef('');

  const renderCss = (values: IChromePanelValues | null | undefined) => {
    const css =
      values && Object.keys(values).length
        ? buildChromePanelCss(sanitizeChromePanelValues(values))
        : '';
    if (css !== lastCssRef.current) {
      lastCssRef.current = css;
      applyChromePanelCss(css);
    }
  };

  // 持久化值变化(含启动加载)。
  React.useEffect(() => {
    renderCss(saved);
  }, [saved]);

  // live 预览:不经 React state,直接换 adopted stylesheet 内容。
  React.useEffect(() => {
    const onPreview = (_e: unknown, values: IChromePanelValues) => {
      renderCss(values);
    };
    ipcRenderer.on('chrome-style-preview', onPreview);
    return () => {
      ipcRenderer.removeListener('chrome-style-preview', onPreview);
    };
  }, []);

  return null;
});

// 工作区颜色属于窗口身份，不允许 Chrome 扩展主题或用户框架 CSS 改写。
// 放在两者之后并限定到工作区窗口，避免影响普通窗口的自定义能力。
const WorkspaceChromeStyle = observer(() => {
  if (!store.workspaceContext || store.isIncognito) return null;
  const theme = store.theme;

  return (
    <style data-rainsee-workspace-css>{`
      #app [data-rainsee-chrome="true"] [data-rainsee-part="titlebar"] {
        background-color: ${theme['titlebar.backgroundColor']} !important;
        background-image: none !important;
      }
      #app [data-rainsee-chrome="true"] [data-rainsee-part="toolbar"],
      #app [data-rainsee-chrome="true"] [data-rainsee-part="bookmark-bar"] {
        background-color: ${theme['toolbar.backgroundColor']} !important;
        background-image: none !important;
        border-color: ${theme['toolbar.bottomLine.backgroundColor']} !important;
      }
      #app [data-rainsee-chrome="true"] [data-rainsee-area="sidebar"] {
        background-color: ${theme['sidebar.backgroundColor'] || theme['titlebar.backgroundColor']} !important;
        background-image: none !important;
        border-color: ${theme['toolbar.bottomLine.backgroundColor']} !important;
      }
      #app [data-rainsee-chrome="true"] [data-rainsee-part="tab"][data-rainsee-selected="true"]
        > [data-rainsee-part="tab-surface"] {
        background-color: ${theme['tab.selected.backgroundColor'] || theme['toolbar.backgroundColor']} !important;
        background-image: none !important;
      }
      #app [data-rainsee-chrome="true"] [data-rainsee-part="sidebar-tab"][data-rainsee-selected="true"] {
        background-color: ${theme['sidebar.tab.selectedBackgroundColor'] || theme['toolbar.backgroundColor']} !important;
        background-image: none !important;
      }
    `}</style>
  );
});

const TopLayout = observer(() => {
  const headerRef = React.useRef<HTMLDivElement>(null);
  const useImmersiveOverlay =
    store.settings.object.immersiveBrowsing && !store.isSidebar;

  React.useEffect(() => {
    ipcRenderer.send(
      `immersive-header-enabled-${store.windowId}`,
      !!useImmersiveOverlay,
    );

    return () => {
      ipcRenderer.send(`immersive-header-enabled-${store.windowId}`, false);
    };
  }, [useImmersiveOverlay]);

  React.useEffect(() => {
    ipcRenderer.send(`immersive-page-indicator-sync-${store.windowId}`);
  }, [store.settings.object.immersivePageIndicator]);

  return (
    <StyledApp data-rainsee-chrome="true">
      <UIStyle />
      {!useImmersiveOverlay && (
        <TopChrome ref={headerRef} data-rainsee-area="topbar">
          <HeaderWrapper>
            <Titlebar />
            {store.settings.object.topBarVariant === 'default' && <Toolbar />}
          </HeaderWrapper>
          <BookmarkBar />
          <HeaderFileDropPanel
            targetRef={headerRef}
            windowId={store.windowId}
          />
        </TopChrome>
      )}
      <ViewAnchor id="view-anchor" />
    </StyledApp>
  );
});

const SidebarLayout = observer(() => {
  const sidebar = <Sidebar />;
  const toolbarRef = React.useRef<HTMLDivElement>(null);

  return (
    <SidebarShell data-rainsee-chrome="true">
      <UIStyle />
      {!store.isFullscreen && (
        <SidebarTopDrag
          data-rainsee-area="sidebar"
          $macLeft={platform() === 'darwin' && store.tabsLayout === 'left'}
        />
      )}
      <SidebarBody>
        {store.tabsLayout === 'left' && sidebar}
        <ContentColumn>
          <TopChrome ref={toolbarRef} data-rainsee-area="topbar">
            <HeaderWrapper>
              <Toolbar />
            </HeaderWrapper>
            <BookmarkBar />
            <HeaderFileDropPanel
              targetRef={toolbarRef}
              windowId={store.windowId}
            />
          </TopChrome>
          <ViewAnchor id="view-anchor" />
        </ContentColumn>
        {store.tabsLayout === 'right' && sidebar}
      </SidebarBody>
    </SidebarShell>
  );
});

const App = observer(() => {
  const [showProfileOnboardingNotice, setShowProfileOnboardingNotice] =
    React.useState(false);

  // When the layout changes (top <-> sidebar, or side swap), the #view-anchor
  // node is remounted, so the main-process ResizeObserver may be watching a
  // stale node. Nudge the main process to re-measure after the DOM settles.
  React.useEffect(() => {
    requestAnimationFrame(() => {
      ipcRenderer.send('resize-height');
    });
  }, [
    store.tabsLayout,
    store.settings.object.topBarVariant,
    store.settings.object.immersiveBrowsing,
  ]);

  React.useEffect(() => {
    syncStartupShellTheme(store.settings.object);
  }, [
    store.settings.object.theme,
    store.settings.object.activeChromeTheme,
  ]);

  React.useEffect(() => {
    const onSettingsUpdate = (_e: Electron.IpcRendererEvent, settings: ISettings) => {
      syncStartupShellTheme(settings);
    };

    ipcRenderer.on('update-settings', onSettingsUpdate);
    return () => {
      ipcRenderer.removeListener('update-settings', onSettingsUpdate);
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    let dismissTimer: number | undefined;

    ipcRenderer
      .invoke('consume-profile-onboarding-skipped-notice')
      .then((shouldShow: boolean) => {
        if (!active || !shouldShow) return;
        setShowProfileOnboardingNotice(true);
        dismissTimer = window.setTimeout(() => {
          setShowProfileOnboardingNotice(false);
        }, 8000);
      })
      .catch((error) => {
        console.error('[onboarding] read profile skipped notice failed', error);
      });

    return () => {
      active = false;
      if (dismissTimer !== undefined) window.clearTimeout(dismissTimer);
    };
  }, []);

  const restoreOnboarding = () => {
    setShowProfileOnboardingNotice(false);
    ipcRenderer.invoke('show-onboarding').catch((error) => {
      console.error('[onboarding] restore failed', error);
    });
  };

  return (
    <ThemeProvider
      theme={{
        ...(store.isIncognito ? getTheme('wexond-dark') : store.theme),
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
      {store.isSidebar ? <SidebarLayout /> : <TopLayout />}
      <ChromeExtensionThemeStyle />
      <ChromePanelStyle />
      <ChromeUserStyle />
      <WorkspaceChromeStyle />
      <ClearExitOverlay />
      {showProfileOnboardingNotice && (
        <AppToastStack aria-live="polite">
          <ProfileOnboardingToast role="status">
            <span>已跳过首次使用引导</span>
            <ProfileOnboardingAction type="button" onClick={restoreOnboarding}>
              恢复引导
            </ProfileOnboardingAction>
          </ProfileOnboardingToast>
        </AppToastStack>
      )}
    </ThemeProvider>
  );
});

export default App;
