import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import {
  HouseSimpleIcon,
  PuzzlePiece,
  ClockCounterClockwiseIcon,
  BookmarksSimpleIcon,
  Broom,
  Camera,
  Translate,
} from '@phosphor-icons/react';

import { ToolbarButton } from '../ToolbarButton';
import { ICON_DOWNLOAD, ICON_MORE } from '~/renderer/constants/icons';
import { getWebUIURL } from '~/common/webui';
import store from '../../store';
import { useDelayedHover } from '../../utils/delayed-hover';
import { getShellTranslator } from '../../utils/i18n';

// ---------------------------------------------------------------------------
// 模块级 ref:菜单 / 下载 / 扩展列表 三个按钮各自唯一,用于定位其弹窗坐标。
// (从原 RightButtons 搬迁,行为不变。)
// ---------------------------------------------------------------------------
let menuRef: HTMLDivElement = null;
let downloadDialogRef: HTMLDivElement = null;
let extensionsListRef: HTMLDivElement = null;
let clearBrowsingDataRef: HTMLDivElement = null;
// 开源版：AI / 订阅集群按钮与账号体系已移除。


// ---------------------------------------------------------------------------
// 弹窗坐标定位 + IPC 触发(从原 RightButtons 搬迁,行为不变)。
// ---------------------------------------------------------------------------
const showDownloadDialog = async () => {
  if (downloadDialogRef == null) {
    return;
  }
  const { right, bottom } = downloadDialogRef.getBoundingClientRect();
  store.downloadNotification = false;
  ipcRenderer.send(`show-downloads-dialog-${store.windowId}`, right, bottom);
};

ipcRenderer.on('show-download-dialog', () => {
  showDownloadDialog();
});

const onDownloadsClick = async (e?: React.MouseEvent<HTMLDivElement>) => {
  if (e && e.button !== 0) return;
  showDownloadDialog();
};

const showMenuDialog = async () => {
  const { right, bottom } = menuRef.getBoundingClientRect();
  ipcRenderer.send(`show-menu-dialog-${store.windowId}`, right, bottom);
};

ipcRenderer.on('show-menu-dialog', () => {
  showMenuDialog();
});

const onMenuClick = async () => {
  showMenuDialog();
};

const showExtensionsListDialog = async () => {
  if (extensionsListRef == null) return;
  const { right, bottom } = extensionsListRef.getBoundingClientRect();
  ipcRenderer.send(`show-extensions-list-${store.windowId}`, right, bottom);
};

const onExtensionsClick = async () => {
  showExtensionsListDialog();
};

const onHomeClick = () => {
  store.tabs.selectedTab.callViewMethod('home');
};

const popupOpenAt: Record<string, number> = {};

const openHistoryBookmarksPopup = (
  kind: 'history' | 'bookmarks',
  element: HTMLDivElement | null,
) => {
  if (!element) return;
  const now = Date.now();
  if (now - (popupOpenAt[kind] || 0) < 180) return;
  popupOpenAt[kind] = now;
  const { right, bottom } = element.getBoundingClientRect();
  ipcRenderer.send(
    `history-bookmarks-popup-open-${store.windowId}`,
    kind,
    Math.round(right),
    Math.round(bottom),
  );
};

const closeHistoryBookmarksPopup = () => {
  ipcRenderer.send(`history-bookmarks-popup-close-${store.windowId}`);
};

const onClearBrowsingDataClick = (e?: React.MouseEvent<HTMLDivElement>) => {
  if (e && e.button !== 0) return;
  if (!clearBrowsingDataRef) return;
  const { right, bottom } = clearBrowsingDataRef.getBoundingClientRect();
  ipcRenderer.send(
    `show-clear-browsing-data-dialog-${store.windowId}`,
    right,
    bottom,
    {
      url: store.tabs.selectedTab?.url || '',
      incognito: !!store.tabs.selectedTab?.incognito,
    },
  );
};

const onScreenshotClick = (e?: React.MouseEvent<HTMLDivElement>) => {
  if (e && e.button !== 0) return;
  ipcRenderer.send(`show-screenshot-dialog-${store.windowId}`);
};

const onTranslatePageClick = (e?: React.MouseEvent<HTMLDivElement>) => {
  if (e && e.button !== 0) return;
  ipcRenderer.send(`translate-start-${store.windowId}`);
};

// ---------------------------------------------------------------------------
// 工具栏空白处右键 → 外观设置中的自定义工具栏分区(参考 Edge)。
// ---------------------------------------------------------------------------
const openCustomizeToolbarSettings = () => {
  store.tabs.addTab({
    url: `${getWebUIURL('settings')}?section=appearance`,
    active: true,
  });
};

const openDownloadsPage = () => {
  store.tabs.addTab({ url: getWebUIURL('downloads'), active: true });
};

const openDownloadSettings = () => {
  store.tabs.addTab({
    url: `${getWebUIURL('settings')}?section=downloads`,
    active: true,
  });
};

const showDownloadsContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.stopPropagation();
  const t = getShellTranslator();

  const menu = remote.Menu.buildFromTemplate([
    {
      label: t('shellOpenDownloadsPage'),
      click: () => openDownloadsPage(),
    },
    {
      label: t('shellClearDownloadHistory'),
      click: () => {
        ipcRenderer.invoke('download-clear-history').catch(() => {});
      },
    },
    {
      type: 'separator',
    },
    {
      label: t('shellDownloadSettings'),
      click: () => openDownloadSettings(),
    },
    {
      label: t('customizeToolbar'),
      click: () => openCustomizeToolbarSettings(),
    },
  ]);
  menu.popup();
};

export const showToolbarContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  const menu = remote.Menu.buildFromTemplate([
    {
      label: getShellTranslator()('customizeToolbar'),
      click: () => openCustomizeToolbarSettings(),
    },
  ]);
  menu.popup();
};

// ---------------------------------------------------------------------------
// 各集群按钮具名组件(从原 NavigationButtons / RightButtons 抽出,逻辑不变)。
// ---------------------------------------------------------------------------

export const HomeButton = observer(() => {
  const iconColor = store.theme['toolbar.lightForeground']
    ? '#fff'
    : 'rgb(117 128 154)';
  return (
    <ToolbarButton
      rainseeAction="home"
      size={20}
      icon={HouseSimpleIcon}
      iconColor={iconColor}
      iconWeight="bold"
      autoInvert={false}
      onClick={onHomeClick}
    />
  );
});

export const ExtensionsButton = observer(() => (
  <ToolbarButton
    rainseeAction="extensions"
    className="right-action right-action--extensions-entry"
    divRef={(r) => (extensionsListRef = r)}
    onMouseDown={onExtensionsClick}
    toggled={store.dialogsVisibility['extensions-list']}
    icon={PuzzlePiece}
    iconWeight="bold"
    autoInvert={false}
    size={18}
  />
));

export const DownloadsButton = observer(() => {
  const visibility = store.settings.toolbarLayout.downloadVisibility;
  if (
    visibility === 'hidden' ||
    (visibility === 'on-download' && !store.downloadsButtonVisible)
  ) {
    return null;
  }
  return (
    <ToolbarButton
      rainseeAction="downloads"
      divRef={(r) => (downloadDialogRef = r)}
      size={18}
      badge={store.downloadNotification}
      onMouseDown={onDownloadsClick}
      onContextMenu={showDownloadsContextMenu}
      toggled={store.dialogsVisibility['downloads-dialog']}
      icon={ICON_DOWNLOAD}
      badgeTop={9}
      badgeRight={9}
      preloader
      value={store.downloadProgress}
    />
  );
});

// 开源版：SubscribeButton / AiButton 已随云服务移除。

export const MenuButton = observer(() => (
  <ToolbarButton
    rainseeAction="menu"
    divRef={(r) => (menuRef = r)}
    toggled={store.dialogsVisibility['menu']}
    onMouseDown={onMenuClick}
    icon={ICON_MORE}
    size={18}
  />
));

export const HistoryButton = observer(() => {
  const t = getShellTranslator();
  const buttonRef = React.useRef<HTMLDivElement>(null);
  const popupHover = useDelayedHover(() =>
    openHistoryBookmarksPopup('history', buttonRef.current),
  );

  return (
    <ToolbarButton
      rainseeAction="history"
      divRef={(element) => (buttonRef.current = element)}
      icon={ClockCounterClockwiseIcon}
      iconWeight="bold"
      autoInvert={false}
      size={18}
      title={t('pvItemHistory')}
      onMouseEnter={popupHover.schedule}
      onMouseLeave={() => {
        popupHover.cancel();
        ipcRenderer.send(
          `history-bookmarks-popup-hover-leave-${store.windowId}`,
        );
      }}
      onMouseDown={() => {
        popupHover.cancel();
        closeHistoryBookmarksPopup();
        store.tabs.addTab({ url: getWebUIURL('history'), active: true });
      }}
    />
  );
});

export const BookmarksButton = observer(() => {
  const t = getShellTranslator();
  const buttonRef = React.useRef<HTMLDivElement>(null);
  const popupHover = useDelayedHover(() =>
    openHistoryBookmarksPopup('bookmarks', buttonRef.current),
  );

  return (
    <ToolbarButton
      rainseeAction="bookmarks"
      divRef={(element) => (buttonRef.current = element)}
      icon={BookmarksSimpleIcon}
      iconWeight="bold"
      autoInvert={false}
      size={18}
      title={t('shellFavorites')}
      onMouseEnter={popupHover.schedule}
      onMouseLeave={() => {
        popupHover.cancel();
        ipcRenderer.send(
          `history-bookmarks-popup-hover-leave-${store.windowId}`,
        );
      }}
      onMouseDown={() => {
        popupHover.cancel();
        closeHistoryBookmarksPopup();
        store.tabs.addTab({ url: getWebUIURL('bookmarks'), active: true });
      }}
    />
  );
});

export const ClearBrowsingDataButton = observer(() => (
  <ToolbarButton
    rainseeAction="clear-browsing-data"
    title={getShellTranslator()('shellClearDataBtn')}
    divRef={(r) => (clearBrowsingDataRef = r)}
    icon={Broom}
    iconWeight="bold"
    autoInvert={false}
    size={18}
    onMouseDown={onClearBrowsingDataClick}
  />
));

export const ScreenshotButton = observer(() => (
  <ToolbarButton
    rainseeAction="screenshot"
    title={getShellTranslator()('shellScreenshot')}
    icon={Camera}
    iconWeight="bold"
    autoInvert={false}
    size={18}
    onMouseDown={onScreenshotClick}
  />
));

export const TranslatePageButton = observer(() => (
  <ToolbarButton
    rainseeAction="translate-page"
    title={getShellTranslator()('shellTranslatePage')}
    icon={Translate}
    iconWeight="bold"
    autoInvert={false}
    size={18}
    onMouseDown={onTranslatePageClick}
  />
));

// 按 id 渲染对应的集群按钮(供 NavigationButtons/RightButtons 按 toolbarLayout 顺序调用)。
// 未知 id 返回 null(由 resolveToolbarLayout 兜底,理论上不会发生)。
export const renderClusterButton = (id: string): React.ReactElement | null => {
  switch (id) {
    case 'home':
      return <HomeButton />;
    case 'extensions':
      return <ExtensionsButton />;
    case 'downloads':
      return <DownloadsButton />;
    case 'history':
      return <HistoryButton />;
    case 'bookmarks':
      return <BookmarksButton />;
    case 'clear-browsing-data':
      return <ClearBrowsingDataButton />;
    case 'screenshot':
      return <ScreenshotButton />;
    case 'translate-page':
      return <TranslatePageButton />;
    default:
      return null;
  }
};
