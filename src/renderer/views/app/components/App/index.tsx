import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ThemeProvider } from 'styled-components';
import { ipcRenderer } from 'electron';

import {
  StyledApp,
  SidebarShell,
  SidebarTopDrag,
  SidebarBody,
  ContentColumn,
  ViewAnchor,
  HeaderWrapper,
  TopChrome,
} from './style';
import { Titlebar } from '../Titlebar';
import { Toolbar } from '../Toolbar';
import { Sidebar } from '../Sidebar';
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

const syncStartupShellTheme = (settings: Partial<ISettings>) => {
  const dark = store.isIncognito || settings.theme === 'wexond-dark';
  const bg = dark ? '#1c1c1c' : '#ffffff';
  document.documentElement.style.backgroundColor = bg;
  (document.documentElement.style as any).colorScheme = dark ? 'dark' : 'light';
  document.body.style.backgroundColor = bg;
  const app = document.getElementById('app');
  if (app) {
    app.style.backgroundColor = bg;
  }
};

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

  return (
    <StyledApp>
      <UIStyle />
      {!useImmersiveOverlay && (
        <TopChrome ref={headerRef}>
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
    <SidebarShell>
      <UIStyle />
      {!store.isFullscreen && <SidebarTopDrag />}
      <SidebarBody>
        {store.tabsLayout === 'left' && sidebar}
        <ContentColumn>
          <TopChrome ref={toolbarRef}>
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
  }, [store.settings.object.theme]);

  React.useEffect(() => {
    const onSettingsUpdate = (_e: Electron.IpcRendererEvent, settings: ISettings) => {
      syncStartupShellTheme(settings);
    };

    ipcRenderer.on('update-settings', onSettingsUpdate);
    return () => {
      ipcRenderer.removeListener('update-settings', onSettingsUpdate);
    };
  }, []);

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
    </ThemeProvider>
  );
});

export default App;
