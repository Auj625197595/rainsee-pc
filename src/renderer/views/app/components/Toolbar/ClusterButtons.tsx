import {observer} from 'mobx-react-lite';
import * as React from 'react';
import {ipcRenderer, nativeImage} from 'electron';
import * as remote from '@electron/remote';
import {renderToStaticMarkup} from 'react-dom/server';
import {
  HouseSimpleIcon,
  PuzzlePiece,
  Sparkle,
  BellSimple,
  ClockCounterClockwiseIcon,
  BookmarksSimpleIcon,
  FileText,
  TextT,
  MagnifyingGlass,
  NotePencil,
  GlobeSimple,
  Note,
} from '@phosphor-icons/react';

import {ToolbarButton} from '../ToolbarButton';
import {ICON_DOWNLOAD, ICON_MORE} from '~/renderer/constants/icons';
import {AiPill} from '../RightButtons/style';
import {getWebUIURL} from '~/common/webui';
import store from '../../store';

// ---------------------------------------------------------------------------
// 模块级 ref:菜单 / 下载 / 扩展列表 三个按钮各自唯一,用于定位其弹窗坐标。
// (从原 RightButtons 搬迁,行为不变。)
// ---------------------------------------------------------------------------
let menuRef: HTMLDivElement = null;
let downloadDialogRef: HTMLDivElement = null;
let extensionsListRef: HTMLDivElement = null;
const MENU_ICON_DIP = 16;
type AccountInfo = {
  userkey?: string;
} | null;

// ---------------------------------------------------------------------------
// AI 右键菜单图标栅格化缓存(theme×scale 维度)。从原 RightButtons 搬迁。
// ---------------------------------------------------------------------------
const aiMenuIconsCache = new Map<string, Promise<{
  summarize: Electron.NativeImage;
  explain: Electron.NativeImage;
  search: Electron.NativeImage;
  pageNote: Electron.NativeImage;
  pageKb: Electron.NativeImage;
  selectionNote: Electron.NativeImage;
}>>();

const menuIcon = (
  IconComponent: React.ComponentType<any>,
): Promise<Electron.NativeImage> => {
  const dark = remote.nativeTheme.shouldUseDarkColors;
  const color = dark ? '#e3e3e3' : '#1c1c1c';
  const svg = renderToStaticMarkup(
    React.createElement(IconComponent, {
      size: MENU_ICON_DIP,
      color,
      weight: 'regular',
    }),
  );
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const deviceScale = Number(
    Math.max(1, window.devicePixelRatio || 1).toFixed(2),
  );
  const scaleFactors = Array.from(
    new Set([1, deviceScale, deviceScale < 2 ? 2 : deviceScale]),
  ).sort((a, b) => a - b);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const icon = nativeImage.createEmpty();

      for (const scaleFactor of scaleFactors) {
        const px = Math.max(16, Math.round(MENU_ICON_DIP * scaleFactor));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, px, px);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, px, px);
        icon.addRepresentation({
          scaleFactor,
          width: px,
          height: px,
          dataURL: canvas.toDataURL('image/png'),
        });
      }

      resolve(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    };
    img.onerror = () => resolve(nativeImage.createEmpty());
    img.src = url;
  });
};

const getAiMenuIcons = () => {
  const themeKey = remote.nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const scaleKey = Number(Math.max(1, window.devicePixelRatio || 1).toFixed(2));
  const cacheKey = `${themeKey}:${scaleKey}`;
  const cached = aiMenuIconsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = Promise.all([
      menuIcon(FileText),
      menuIcon(TextT),
      menuIcon(MagnifyingGlass),
      menuIcon(NotePencil),
      menuIcon(GlobeSimple),
      menuIcon(Note),
    ]).then(
      ([
        summarize,
        explain,
        search,
        pageNote,
        pageKb,
        selectionNote,
      ]) => ({
        summarize,
        explain,
        search,
        pageNote,
        pageKb,
        selectionNote,
      }),
    );

  aiMenuIconsCache.set(cacheKey, task);
  return task;
};

// ---------------------------------------------------------------------------
// 弹窗坐标定位 + IPC 触发(从原 RightButtons 搬迁,行为不变)。
// ---------------------------------------------------------------------------
const showDownloadDialog = async () => {
  if (downloadDialogRef == null) {
    return;
  }
  const {right, bottom} = downloadDialogRef.getBoundingClientRect();
  store.downloadNotification = false;
  ipcRenderer.send(`show-downloads-dialog-${store.windowId}`, right, bottom);
};

ipcRenderer.on('show-download-dialog', () => {
  showDownloadDialog();
});

const onDownloadsClick = async () => {
  showDownloadDialog();
};

const showMenuDialog = async () => {
  const {right, bottom} = menuRef.getBoundingClientRect();
  ipcRenderer.send(`show-menu-dialog-${store.windowId}`, right, bottom);
};

ipcRenderer.on('show-menu-dialog', () => {
  showMenuDialog();
});

const onMenuClick = async () => {
  showMenuDialog();
};

// hover 时后台预加载菜单弹窗(不显示),使点击即秒开。
const onMenuHover = () => {
  ipcRenderer.send(`preload-dialog-on-hover-${store.windowId}`, 'menu');
};

const showExtensionsListDialog = async () => {
  if (extensionsListRef == null) return;
  const {right, bottom} = extensionsListRef.getBoundingClientRect();
  ipcRenderer.send(`show-extensions-list-${store.windowId}`, right, bottom);
};

const onExtensionsClick = async () => {
  showExtensionsListDialog();
};

// hover 时后台预加载扩展列表弹窗(不显示),使点击即秒开。
const onExtensionsHover = () => {
  ipcRenderer.send(
    `preload-dialog-on-hover-${store.windowId}`,
    'extensions-list',
  );
};

const onHomeClick = () => {
  store.tabs.selectedTab.callViewMethod('home');
};

// 历史/书签管理器:作为新标签页打开对应 WebUI 页(与 QuickMenu / BookmarkBar 一致)。
const onHistoryClick = () => {
  store.tabs.addTab({ url: getWebUIURL('history'), active: true });
};

const onBookmarksClick = () => {
  store.tabs.addTab({ url: getWebUIURL('bookmarks'), active: true });
};

// ---------------------------------------------------------------------------
// 工具栏空白处右键 → 自定义工具栏(直达设置页该分区,参考 Edge)。
// ---------------------------------------------------------------------------
const openCustomizeToolbarSettings = () => {
  store.tabs.addTab({
    url: `${getWebUIURL('settings')}?section=customize-toolbar`,
    active: true,
  });
};

export const showToolbarContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  const menu = remote.Menu.buildFromTemplate([
    {
      label: '自定义工具栏',
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
    className="right-action right-action--extension"
    divRef={(r) => (extensionsListRef = r)}
    onMouseDown={onExtensionsClick}
    onMouseEnter={onExtensionsHover}
    toggled={store.dialogsVisibility['extensions-list']}
    icon={PuzzlePiece}
    iconWeight="bold"
    autoInvert={false}
    size={18}
  />
));

export const DownloadsButton = observer(() => {
  // 维持原有的「智能显隐」:仅当有下载活动(downloadsButtonVisible)时才出现。
  // 自定义工具栏的 hidden 门控在 renderClusterButton 一层处理(永久隐藏)。
  if (!store.downloadsButtonVisible) return null;
  return (
    <ToolbarButton
      divRef={(r) => (downloadDialogRef = r)}
      size={18}
      badge={store.downloadNotification}
      onMouseDown={onDownloadsClick}
      toggled={store.dialogsVisibility['downloads-dialog']}
      icon={ICON_DOWNLOAD}
      badgeTop={9}
      badgeRight={9}
      preloader
      value={store.downloadProgress}
    />
  );
});


export const MenuButton = observer(() => (
  <ToolbarButton
    divRef={(r) => (menuRef = r)}
    toggled={store.dialogsVisibility['menu']}
    badge={store.updateAvailable}
    badgeRight={10}
    badgeTop={6}
    onMouseDown={onMenuClick}
    onMouseEnter={onMenuHover}
    icon={ICON_MORE}
    size={18}
  />
));

export const HistoryButton = observer(() => (
  <ToolbarButton
    icon={ClockCounterClockwiseIcon}
    iconWeight="bold"
    autoInvert={false}
    size={18}
    onMouseDown={onHistoryClick}
  />
));

export const BookmarksButton = observer(() => (
  <ToolbarButton
    icon={BookmarksSimpleIcon}
    iconWeight="bold"
    autoInvert={false}
    size={18}
    onMouseDown={onBookmarksClick}
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
    default:
      return null;
  }
};
