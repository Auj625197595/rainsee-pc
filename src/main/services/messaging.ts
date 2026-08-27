import {
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  webFrameMain,
} from 'electron';
import { parse } from 'url';
//import { getPassword, setPassword, deletePassword } from 'keytar';

import { AppWindow } from '../windows';
import { Application } from '../application';
import { MenuDialog } from '../dialogs/menu';
import { ExtensionsListDialog } from '../dialogs/extensions-list';
import { PreviewDialog } from '../dialogs/preview';
import { TabGroupPreviewDialog } from '../dialogs/tabgroup-preview';
import { SidebarPanelDialog } from '../dialogs/sidebar-panel';
import { IFormFillData, IBookmark } from '~/interfaces';
import {
  hasSameHostname,
  hostMatches,
  extractSearchQuery,
  getIconByUrlNet,
} from '~/utils/url';
import { SearchDialog } from '../dialogs/search';

import * as bookmarkMenu from '../menus/bookmarks';
import { printPage, showPageToast } from '../menus/common-actions';
import { showFindDialog } from '../dialogs/find';
import { AddBookmarkDialog } from '../dialogs/add-bookmark';
import { showExtensionDialog } from '../dialogs/extension-popup';
import { showDownloadsDialog } from '../dialogs/downloads';
import { showZoomDialog } from '../dialogs/zoom';
import { SearchEnginesDialog } from '../dialogs/search-engines';
import { SiteCookieData, SiteInfoDialog } from '../dialogs/site-info';
import {
  ClearBrowsingDataDialog,
  ClearBrowsingDataDialogPayload,
} from '../dialogs/clear-browsing-data';
import { TranslateDialog } from '../dialogs/translate';
import { HistoryBookmarksDialog } from '../dialogs/history-bookmarks';
import { FormFillDialog } from '../dialogs/form-fill';
import { InstallAppDialog } from '../dialogs/install-app';
import {
  performInstall,
  isUrlInstalled,
  COLLECT_PAGE_INFO_CODE,
  buildInstallableManifest,
  injectManifestCode,
  manifestToWebJson,
  CollectedPageInfo,
  PwaManifest,
} from './pwa';
import { showTabGroupDialog } from '../dialogs/tabgroup';
import { ShowBlockDialog } from '~/main/dialogs/show-block';
import { ShareDialog } from '~/main/dialogs/share';
import { ScreenshotDialog } from '~/main/dialogs/screenshot';
import { UpdateDialog } from '~/main/dialogs/update';
import { showVideoDialog } from '~/main/dialogs/show-video';
import { showMediaPlayer } from '~/main/windows/media-player';
// 开源版：手机互联(phone tabs)模块已移除。
import {
  BookmarkOverflowDialog,
  BookmarkOverflowOpenOptions,
} from '../dialogs/bookmark-overflow';
import { saveAdblockRule } from '~/main/services/adblock';
import { getWebUIURL } from '~/common/webui-main';
import { parseBrowserInternalUrl } from '~/common/browser-internal-url';
import {
  hideCredentialPrompt,
  requestCredentialPromptFromPage,
  saveCredentialPrompt,
} from './credential-prompt';
import {
  createProfileShortcuts,
  getProfileShortcutDialogData,
  IProfileShortcutOptions,
} from '../profiles';
import { TrackedIpcMain } from './tracked-ipc';

const globalIpc = new TrackedIpcMain();
let globalIpcRegistered = false;

const forwardDialogEventToOwner = (
  dialogName: string,
  senderId: number,
  channel: string,
  payload?: any,
) => {
  const dlg = Application.instance.dialogs.persistentDialogs.find(
    (item: any) => item.name === dialogName && item.webContents.id === senderId,
  ) as any;
  const owner = dlg
    ? Application.instance.windows.fromBrowserWindow(dlg.browserWindow)
    : undefined;
  if (owner) owner.send(channel, payload);
};

const ensureGlobalMessagingIpc = () => {
  if (globalIpcRegistered) return;
  globalIpcRegistered = true;

  globalIpc.on('tabgroup-preview-action', (event, payload) => {
    forwardDialogEventToOwner(
      'tabgroup-preview',
      event.sender.id,
      'tabgroup-preview-action',
      payload,
    );
  });
  globalIpc.on('tabgroup-preview-enter', (event) => {
    forwardDialogEventToOwner(
      'tabgroup-preview',
      event.sender.id,
      'tabgroup-preview-enter',
    );
  });
  globalIpc.on('tabgroup-preview-leave', (event) => {
    forwardDialogEventToOwner(
      'tabgroup-preview',
      event.sender.id,
      'tabgroup-preview-leave',
    );
  });

  globalIpc.on('sidebar-panel-action', (event, payload) => {
    // 开源版：手机互联(phone tabs)已移除，仅转发面板自身动作。
    forwardDialogEventToOwner(
      'sidebar-panel',
      event.sender.id,
      'sidebar-panel-action',
      payload,
    );
  });
  globalIpc.on('sidebar-panel-enter', (event) => {
    forwardDialogEventToOwner(
      'sidebar-panel',
      event.sender.id,
      'sidebar-panel-enter',
    );
  });
  globalIpc.on('sidebar-panel-leave', (event) => {
    forwardDialogEventToOwner(
      'sidebar-panel',
      event.sender.id,
      'sidebar-panel-leave',
    );
  });

  if (process.env.ENABLE_AUTOFILL) {
    globalIpc.handle('credentials-get-password', async (_event, id: string) => {
      const item = await Application.instance.storage.findOne<IFormFillData>({
        scope: 'formfill',
        query: { _id: id },
      });
      return item?.fields?.password || '';
    });
  }
};

export const runMessagingService = (appWindow: AppWindow) => {
  ensureGlobalMessagingIpc();
  const ipcMain = new TrackedIpcMain();
  const { id } = appWindow;
  const pcSearchRequests = new Map<
    number,
    {
      bridgeId: string;
      senderId: number;
      itemIds: Set<number>;
      expiresAt: number;
      acting: boolean;
    }
  >();
  let installDialogContext:
    | {
        type: 'pwa';
        viewId: number;
        manifest: PwaManifest;
        pageUrl: string;
        fallbackIconUrl: string;
        installing: boolean;
      }
    | { type: 'profile'; name: string }
    | null = null;
  let quickPwaOpening = false;

  appWindow.win.once('closed', () => {
    ipcMain.dispose();
    pcSearchRequests.clear();
    installDialogContext = null;
  });

  const isSelectedNewTabSender = (sender: Electron.WebContents) => {
    const view = appWindow.viewManager.selected;
    return (
      !!view &&
      view.webContents === sender &&
      view.webContents.getURL().startsWith(getWebUIURL('newtab'))
    );
  };

  const prunePcSearchRequests = () => {
    const now = Date.now();
    for (const [requestId, request] of pcSearchRequests) {
      if (request.expiresAt <= now) pcSearchRequests.delete(requestId);
    }
    while (pcSearchRequests.size > 32) {
      const first = pcSearchRequests.keys().next().value;
      if (first === undefined) break;
      pcSearchRequests.delete(first);
    }
  };

  const getPwaFallbackIcon = (url: string, favicon?: string) =>
    favicon || getIconByUrlNet(url);

  ipcMain.on(`window-focus-${id}`, () => {
    appWindow.win.focus();
    appWindow.webContents.focus();
  });

  ipcMain.on(`window-toggle-maximize-${id}`, () => {
    if (appWindow.win.isMaximized()) {
      appWindow.win.unmaximize();
    } else {
      appWindow.win.maximize();
    }
  });

  ipcMain.on(`window-minimize-${id}`, () => {
    appWindow.win.minimize();
  });

  ipcMain.on(`window-close-${id}`, () => {
    appWindow.win.close();
  });

  ipcMain.on(`window-fix-dragging-${id}`, () => {
    appWindow.fixDragging();
  });

  ipcMain.on(`show-menu-dialog-${id}`, (e, x, y) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'menu',
    ) as MenuDialog;
    dialog.open(appWindow.win, x, y);
  });

  // 分享:屏幕居中弹窗,展示二维码 + 短链。
  // payload 可选——标签右键菜单传入指定标签页的 {url, title};QuickMenu 不传,用当前选中页。
  ipcMain.on(
    `show-share-dialog-${id}`,
    (e, payload?: { url?: string; title?: string }) => {
      const dialog = Application.instance.dialogs.getPersistent(
        'share',
      ) as ShareDialog;
      dialog.open(appWindow.win, payload);
    },
  );

  // QuickMenu 截图:全屏浮层框选,截取当前页 / 长截图
  ipcMain.on(`show-screenshot-dialog-${id}`, () => {
    const dialog = Application.instance.dialogs.getPersistent(
      'screenshot',
    ) as ScreenshotDialog;
    dialog.open(appWindow.win);
  });

  ipcMain.on(`show-extensions-list-${id}`, (e, x, y) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'extensions-list',
    ) as ExtensionsListDialog;
    dialog.open(appWindow.win, x, y, appWindow.incognito);
  });

  ipcMain.on(`search-show-${id}`, (e, data) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'search',
    ) as SearchDialog;

    // 沉浸标题栏运行在独立的透明 BrowserWindow 中。其 DOM 坐标以悬浮窗
    // 内容区为原点，而搜索 BrowserView 挂在主窗口中，必须先换算到主窗口
    // 内容区坐标，否则标题栏与主窗口原点不一致时弹窗会整体错位。
    const senderWindow = BrowserWindow.fromWebContents(e.sender);
    if (senderWindow && senderWindow !== appWindow.win) {
      const senderBounds = senderWindow.getContentBounds();
      const ownerBounds = appWindow.win.getContentBounds();
      const x = Number(data?.x);
      const y = Number(data?.y);

      data = {
        ...data,
        immersive: true,
        immersiveHeaderBottom:
          senderBounds.y - ownerBounds.y + senderBounds.height,
        ...(Number.isFinite(x) && {
          x: x + senderBounds.x - ownerBounds.x,
        }),
        ...(Number.isFinite(y) && {
          y: y + senderBounds.y - ownerBounds.y,
        }),
      };
    }

    dialog.data = data;
    dialog.show(appWindow.win);
  });

  ipcMain.on(`newtab-search-show-${id}`, (e, data) => {
    const view = appWindow.viewManager.selected;
    if (
      !view ||
      view.webContents !== e.sender ||
      !view.webContents.getURL().startsWith(getWebUIURL('newtab'))
    ) {
      return;
    }

    const viewBounds = view.browserView.getBounds();
    const rawX = Number(data?.x);
    const rawY = Number(data?.y);
    const rawWidth = Number(data?.width);
    const rawHeight = Number(data?.height);
    if (
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      !Number.isFinite(rawWidth) ||
      !Number.isFinite(rawHeight)
    ) {
      return;
    }

    const width = Math.min(
      Math.max(Math.round(rawWidth), 160),
      viewBounds.width,
    );
    const anchorHeight = Math.min(Math.max(Math.round(rawHeight), 36), 64);
    const x = Math.min(
      Math.max(Math.round(rawX), 0),
      Math.max(0, viewBounds.width - width),
    );
    const y = Math.min(
      Math.max(Math.round(rawY), 0),
      Math.max(0, viewBounds.height - anchorHeight),
    );
    const text = typeof data?.text === 'string' ? data.text.slice(0, 2048) : '';
    const rawCursorPos = Number(data?.cursorPos);
    const cursorPos = Math.min(
      Math.max(
        Number.isFinite(rawCursorPos) ? Math.round(rawCursorPos) : text.length,
        0,
      ),
      text.length,
    );

    const dialog = Application.instance.dialogs.getPersistent(
      'search',
    ) as SearchDialog;
    const engineKeyword =
      data?.engineKeyword === 'metaso.cn' ? 'metaso.cn' : undefined;
    const searchMode =
      engineKeyword && data?.searchMode === 'fast_thinking'
        ? 'fast_thinking'
        : 'default';
    const searchTypes = new Set([
      'default',
      'scholar',
      'podcast',
      'image',
      'pdf',
      'webpage',
      'video',
    ]);
    const searchType =
      engineKeyword && searchTypes.has(data?.searchType)
        ? data.searchType
        : 'default';
    dialog.data = {
      text,
      cursorPos,
      selectAll: data?.selectAll !== false,
      x: viewBounds.x + x,
      y: viewBounds.y + y,
      width,
      anchorHeight,
      origin: 'newtab',
      engineKeyword,
      searchMode,
      searchType,
      openInNewTab: false,
    };
    dialog.show(appWindow.win);
  });

  ipcMain.on(`newtab-open-browser-internal-${id}`, (event, payload) => {
    if (!isSelectedNewTabSender(event.sender)) return;

    const location = parseBrowserInternalUrl(payload?.url);
    if (!location) return;

    const targetUrl = `${getWebUIURL(location.page)}${location.suffix}`;
    const selected = appWindow.viewManager.selected;
    if (!selected) return;

    if (payload?.target === '_self') {
      selected.load(targetUrl);
      return;
    }

    appWindow.viewManager.create(
      {
        url: targetUrl,
        active: true,
        incognito: selected.incognito,
      } as any,
      true,
    );
  });

  ipcMain.on(`pc-search-suggestions-${id}`, async (event, payload) => {
    if (!isSelectedNewTabSender(event.sender)) return;

    const requestId = Number(payload?.requestId);
    if (!Number.isSafeInteger(requestId) || requestId < 0) return;
    const fullText =
      typeof payload?.text === 'string' ? payload.text.slice(0, 2048) : '';
    const rawCursor = Number(payload?.cursorPos);
    const cursorPos = Math.min(
      Math.max(
        Number.isFinite(rawCursor) ? Math.round(rawCursor) : fullText.length,
        0,
      ),
      fullText.length,
    );
    const text = fullText.substring(0, cursorPos);
    const engineKeyword =
      typeof payload?.engineKeyword === 'string'
        ? payload.engineKeyword.slice(0, 128)
        : '';
    const bridgeId = `pc-search-${id}-${requestId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const sender = event.sender;
    const searchDialog = Application.instance.dialogs.getPersistent(
      'search',
    ) as SearchDialog;
    const tabs = await searchDialog.requestTabs(appWindow.win);

    if (!isSelectedNewTabSender(sender)) return;
    prunePcSearchRequests();
    pcSearchRequests.set(requestId, {
      bridgeId,
      senderId: sender.id,
      itemIds: new Set(),
      expiresAt: Date.now() + 15_000,
      acting: false,
    });

    searchDialog.requestBridgeSuggestions(
      {
        bridgeId,
        text,
        engineKeyword,
        tabs,
        clipboard: clipboard.readText(),
      },
      (result) => {
        const request = pcSearchRequests.get(requestId);
        if (
          !request ||
          request.bridgeId !== bridgeId ||
          request.senderId !== sender.id ||
          !isSelectedNewTabSender(sender)
        ) {
          return;
        }

        const items = Array.isArray(result?.items)
          ? result.items.slice(0, 10).map((item: any) => ({
              id: Number(item?.id),
              type: item?.type,
              primaryText: item?.primaryText,
              secondaryText: item?.secondaryText,
              displayUrl: item?.displayUrl || item?.url,
              favicon: item?.favicon,
              isSearch: !!item?.isSearch,
            }))
          : [];
        request.itemIds = new Set(
          items
            .map((item: any) => item.id)
            .filter((itemId: number) => Number.isFinite(itemId)),
        );
        request.expiresAt = Date.now() + 15_000;
        sender.send('pc-search-suggestions-result', {
          requestId,
          revision: Number(result?.revision) || 0,
          selectedId: Number(result?.selectedId) || 0,
          items,
        });
      },
    );
  });

  ipcMain.on(`pc-search-suggestion-action-${id}`, async (event, payload) => {
    if (!isSelectedNewTabSender(event.sender)) return;
    prunePcSearchRequests();

    const requestId = Number(payload?.requestId);
    const itemId = Number(payload?.itemId);
    const action = payload?.action === 'remove' ? 'remove' : 'execute';
    const request = pcSearchRequests.get(requestId);
    if (
      !request ||
      request.senderId !== event.sender.id ||
      request.expiresAt <= Date.now() ||
      request.acting ||
      !request.itemIds.has(itemId)
    ) {
      event.sender.send('pc-search-suggestion-action-result', {
        requestId,
        ok: false,
      });
      return;
    }

    const searchDialog = Application.instance.dialogs.getPersistent(
      'search',
    ) as SearchDialog;
    request.acting = true;
    const result = await searchDialog.requestBridgeAction({
      bridgeId: request.bridgeId,
      itemId,
      action,
    });
    request.acting = false;
    if (!result?.ok) {
      event.sender.send('pc-search-suggestion-action-result', {
        requestId,
        ok: false,
      });
      return;
    }

    const command = result.command;
    if (command?.kind === 'select-tab' && Number.isFinite(command.tabId)) {
      appWindow.send('search-select-tab', Number(command.tabId));
      appWindow.win.focus();
    } else if (
      command?.kind === 'navigate' &&
      typeof command.url === 'string'
    ) {
      const query =
        typeof command.query === 'string' ? command.query : undefined;
      const mode = Application.instance.settings.object.efficiencySearchMode;
      if (query && mode === 'multi-tab') {
        appWindow.send('search-open-multi-tabs', query);
      } else {
        const selected = appWindow.viewManager.selected;
        if (selected) {
          selected.load(command.url);
          if (query && mode === 'dual') {
            appWindow.send('pc-search-bridge-dual', {
              query,
              viewId: selected.id,
            });
          }
        }
      }
    }

    event.sender.send('pc-search-suggestion-action-result', {
      requestId,
      ok: true,
      removed: !!result.removed,
    });
  });

  ipcMain.handle(`is-dialog-visible-${id}`, (e, dialog) => {
    return Application.instance.dialogs.isVisible(dialog);
  });

  ipcMain.on(`show-tab-preview-${id}`, (e, tab) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'preview',
    ) as PreviewDialog;
    dialog.tab = tab;
    dialog.show(appWindow.win);
  });

  ipcMain.on(`hide-tab-preview-${id}`, (e, tab) => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'preview',
    ) as PreviewDialog;
    dialog?.scheduleHide();
  });

  // ===== 标签组悬停列表弹窗(独立 BrowserView,浮于网页之上避免被遮挡)=====
  // 宿主(app.html)→ 弹窗:打开/关闭/刷新内容。
  ipcMain.on(`show-tabgroup-preview-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'tabgroup-preview',
    ) as TabGroupPreviewDialog;
    dialog.show(appWindow.win, payload);
  });

  ipcMain.on(`hide-tabgroup-preview-${id}`, () => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'tabgroup-preview',
    ) as TabGroupPreviewDialog;
    dialog?.hide();
  });

  // 刷新已打开弹窗的内容/位置(关闭/重排后),绕开 show() 的 visible 守卫。
  ipcMain.on(`refresh-tabgroup-preview-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'tabgroup-preview',
    ) as TabGroupPreviewDialog;
    if (!dialog?.visible) return;
    dialog.payload = payload;
    dialog.rearrange();
    dialog.send('visible', true, payload);
  });

  // ===== 侧边栏缩放模式悬停浮层(独立 BrowserView,浮于网页之上)=====
  // 与 tabgroup-preview 同构。宿主(app.html)→ 浮层:打开/关闭/刷新。
  ipcMain.on(`show-sidebar-panel-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'sidebar-panel',
    ) as SidebarPanelDialog;
    dialog.show(appWindow.win, payload);
  });

  ipcMain.on(`hide-sidebar-panel-${id}`, () => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'sidebar-panel',
    ) as SidebarPanelDialog;
    dialog?.hide();
  });

  // 刷新已打开浮层的内容/位置(标签增删/选中/标题变化后),绕开 show() 的守卫。
  ipcMain.on(`refresh-sidebar-panel-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'sidebar-panel',
    ) as SidebarPanelDialog;
    if (!dialog?.visible) return;
    dialog.payload = payload;
    dialog.rearrange();
    dialog.bringToTop();
    dialog.send('visible', true, payload);
  });

  const clearTabHover = () => {
    appWindow.send('clear-tab-hover');
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'preview',
    ) as PreviewDialog;
    dialog?.hide();
  };

  ipcMain.on(`view-clear-tab-hover-${id}`, clearTabHover);

  ipcMain.on(`find-show-${id}`, () => {
    showFindDialog(appWindow.win);
  });

  ipcMain.on(`find-in-page-${id}`, () => {
    appWindow.send('find');
  });

  ipcMain.on(`inspect-${id}`, () => {
    appWindow.webContents.inspectElement(0, 0);
  });

  ipcMain.on(`show-add-bookmark-dialog-${id}`, (e, left, top) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'add-bookmark',
    ) as AddBookmarkDialog;
    dialog.open(appWindow.win, left, top);
  });

  // 监听名为 `show-video-dialog-${id}` 的事件，当触发时执行回调函数
  ipcMain.on(`show-video-dialog-${id}`, (e, left, top) => {
    // 调用 showVideoDialog 函数，并传入 appWindow.win、left 和 top 作为参数
    showVideoDialog(appWindow.win, left, top);
  });

  // 打开智能播放器独立窗口(屏幕中央，点外不消失)
  ipcMain.on(`show-media-player-${id}`, () => {
    showMediaPlayer(appWindow.win);
  });

  ipcMain.on(`show-block-dialog-${id}`, (e, left, top, data) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'show-block',
    ) as ShowBlockDialog;
    dialog.open(appWindow.win, left, top, data);
  });

  // 地址栏更新胶囊点击, 打开更新弹窗
  ipcMain.on(`show-update-dialog-${id}`, (e, left, top) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'update',
    ) as UpdateDialog;
    dialog.open(appWindow.win, left, top);
  });

  // 在当前激活标签页注入并启动元素拾取器(标记广告)
  ipcMain.on(`start-adblock-picker-${id}`, async () => {
    const view = appWindow.viewManager.selected;
    if (!view || view.webContents.isDestroyed()) return;
    try {
      const { getAdblockPickerCode } = await import(
        /* webpackChunkName: "on-demand-adblock-picker" */
        '~/main/services/adblock-picker'
      );
      if (view.webContents.isDestroyed()) return;
      view.webContents.focus();
      view.webContents
        .executeJavaScript(getAdblockPickerCode(appWindow.win.id), true)
        .catch((err) => console.log('[adblock-picker] inject failed', err));
    } catch (err) {
      console.log('[adblock-picker] inject error', err);
    }
  });

  // picker 状态回传(进入/取消/提交), 目前仅记录日志, 预留给后续 UI 反馈
  ipcMain.on(
    `adblock-picker-state-${id}`,
    (e, state: string, rule?: string) => {
      console.log('[adblock-picker] state', state, rule || '');
    },
  );

  // picker 生成的规则: 持久化并即时生效
  ipcMain.on(`save-adblock-rule-${id}`, async (e, rule: string) => {
    const view = appWindow.viewManager.selected;
    await saveAdblockRule(rule, view);
  });

  ipcMain.on(`show-adblock-rule-${id}`, (event) => {
    console.log('show-adblock-rule-');
    appWindow.win.webContents.send('show-adblock-rule');
  });

  // if (process.env.ENABLE_EXTENSIONS) {
  //   ipcMain.on(`show-extension-popup-${id}`, (e, left, top, url, inspect) => {
  //     showExtensionDialog(appWindow.win, left, top, url, inspect);
  //   });
  // }

  ipcMain.on(`show-downloads-dialog-${id}`, (e, left, top) => {
    showDownloadsDialog(appWindow.win, left, top);
  });

  ipcMain.on(`show-zoom-dialog-${id}`, (e, left, top) => {
    showZoomDialog(appWindow.win, left, top);
  });

  // 地址栏左侧搜索引擎下拉:在按钮下方弹出独立 BrowserView(可覆盖网页层)
  ipcMain.on(`show-search-engines-dialog-${id}`, (e, left, top) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'search-engines',
    ) as SearchEnginesDialog;
    dialog.open(appWindow.win, left, top);
  });

  // 普通网页的地址栏左侧入口:展示连接状态、Cookie 和站点权限。
  ipcMain.on(`show-site-info-dialog-${id}`, (_e, left, top) => {
    const view = appWindow.viewManager.selected;
    if (!view || view.webContents.isDestroyed()) return;
    const dialog = Application.instance.dialogs.getPersistent(
      'site-info',
    ) as SiteInfoDialog;
    dialog.open(appWindow.win, view.webContents, left, top);
  });

  ipcMain.handle(
    `site-info-remove-cookie-${id}`,
    (event, cookie: SiteCookieData) => {
      const dialog = Application.instance.dialogs.getExistingPersistent(
        'site-info',
      ) as SiteInfoDialog | undefined;
      if (!dialog || event.sender !== dialog.webContents) return [];
      return dialog.removeCookie(cookie);
    },
  );

  ipcMain.handle(`site-info-clear-cookies-${id}`, (event) => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'site-info',
    ) as SiteInfoDialog | undefined;
    if (!dialog || event.sender !== dialog.webContents) return [];
    return dialog.clearCookies();
  });

  ipcMain.handle(`site-info-persist-session-cookies-${id}`, async (event) => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'site-info',
    ) as SiteInfoDialog | undefined;
    if (!dialog || event.sender !== dialog.webContents) return { ok: false };

    const settings = Application.instance.settings;
    if (!settings.object.persistSessionCookies) {
      return { ok: false, requiresSettings: true };
    }

    const host = await dialog.getSessionCookieHost();
    const target = dialog.getTargetWebContents();
    if (!host || !target) return { ok: false };

    const hosts = settings.object.persistSessionCookieHosts || [];
    const alreadyAdded = hosts.includes(host);
    if (!alreadyAdded) {
      settings.updateSettings({
        persistSessionCookieHosts: Array.from(new Set([...hosts, host])),
      });
      void Application.instance.sessions
        .reconcilePersistedSessionCookies()
        .catch((error) =>
          console.error('[cookies] reconcile site setting failed', error),
        );
    }

    showPageToast(
      target,
      alreadyAdded
        ? `${host} 已设置为重启后保持登录`
        : `已为 ${host} 开启重启后保持登录`,
    );
    return { ok: true, host, alreadyAdded };
  });

  ipcMain.on(
    `show-clear-browsing-data-dialog-${id}`,
    (e, right: number, top: number, data: ClearBrowsingDataDialogPayload) => {
      const dialog = Application.instance.dialogs.getPersistent(
        'clear-browsing-data',
      ) as ClearBrowsingDataDialog;
      dialog.open(appWindow.win, right, top, {
        url: String(data?.url || ''),
        incognito: !!data?.incognito,
      });
    },
  );

  // 切换默认搜索引擎并持久化;若当前页是旧引擎的搜索结果页,
  // 取出搜索词用新引擎重新搜索(在主进程统一处理,设置变更会自动广播到各窗口)。
  ipcMain.handle(`switch-search-engine-${id}`, (e, index: number) => {
    const settings = Application.instance.settings;
    const { searchEngines, searchEngine: prevIndex } = settings.object;

    if (
      !Array.isArray(searchEngines) ||
      index < 0 ||
      index >= searchEngines.length ||
      index === prevIndex
    ) {
      return false;
    }

    const prevEngine = searchEngines[prevIndex];
    const nextEngine = searchEngines[index];

    settings.updateSettings({ searchEngine: index });

    try {
      const view = appWindow.viewManager.selected;
      if (view && nextEngine?.url) {
        const currentUrl = view.webContents.getURL();
        const query = extractSearchQuery(prevEngine?.url, currentUrl);
        if (query) {
          const url = nextEngine.url.replace('%s', encodeURIComponent(query));
          view.webContents.loadURL(url);
        }
      }
    } catch (err) {
      console.error('[switch-search-engine] re-search failed', err);
    }

    return true;
  });

  // 开源版：手机互联悬停面板已移除。

  ipcMain.on(`show-tabgroup-dialog-${id}`, (e, tabGroup) => {
    showTabGroupDialog(appWindow.win, tabGroup);
  });

  ipcMain.on(`edit-tabgroup-${id}`, (e, tabGroup) => {
    appWindow.send(`edit-tabgroup`, tabGroup);
  });

  ipcMain.on(`is-incognito-${id}`, (e) => {
    e.returnValue = appWindow.incognito;
  });

  // QuickMenu 打印当前标签页
  ipcMain.on(`print-page-${id}`, () => {
    printPage();
  });

  // 菜单「翻译」:直接开启翻译(设 active + 注入)并把本站加入"始终显示翻译图标"列表。
  ipcMain.on(`translate-start-${id}`, () => {
    appWindow.viewManager.selected?.startTranslation(true);
  });

  // 地址栏翻译图标点击:在译文和原文之间切换,并收起可能已由悬停打开的弹窗。
  ipcMain.on(`translate-toggle-${id}`, () => {
    const view = appWindow.viewManager.selected;
    if (!view) return;
    if (view.translateActive) {
      view.stopTranslation();
    } else {
      view.startTranslation();
    }
    const dialog = Application.instance.dialogs.persistentDialogs.find(
      (item) => item.name === 'translate',
    );
    if (dialog?.visible && dialog.browserWindow === appWindow.win)
      dialog.hide();
  });

  // 地址栏翻译图标悬停:打开语言选择弹窗,不改变当前翻译状态。
  ipcMain.on(`translate-open-${id}`, (_e, left: number, top: number) => {
    const view = appWindow.viewManager.selected;
    if (!view) return;
    const dialog = Application.instance.dialogs.getPersistent(
      'translate',
    ) as TranslateDialog;
    dialog.open(appWindow.win, left, top, {
      active: view.translateActive,
      target: view.translateTarget,
    });
  });

  // 图标与弹窗属于两个 webContents。离开图标后延迟关闭，弹窗的 mouseenter
  // 会取消该计时器，从而只在指针同时离开图标和弹窗后收起。
  ipcMain.on(`translate-hover-leave-${id}`, () => {
    const dialog = Application.instance.dialogs.persistentDialogs.find(
      (item) => item.name === 'translate',
    ) as TranslateDialog | undefined;
    if (dialog?.browserWindow === appWindow.win) dialog.scheduleHoverHide();
  });

  // 地址栏历史/书签悬停列表:独立 BrowserView,确保网页内容不会遮挡弹窗。
  ipcMain.on(
    `history-bookmarks-popup-open-${id}`,
    (_e, kind: 'history' | 'bookmarks', left: number, top: number) => {
      const dialog = Application.instance.dialogs.getPersistent(
        'history-bookmarks-popup',
      ) as HistoryBookmarksDialog;
      if (!dialog) return;
      void dialog.open(appWindow.win, left, top, kind).catch((error) => {
        console.error('[history-bookmarks-popup] open failed', error);
      });
    },
  );

  ipcMain.on(`history-bookmarks-popup-hover-leave-${id}`, () => {
    const dialog = Application.instance.dialogs.persistentDialogs.find(
      (item) =>
        item.name === 'history-bookmarks-popup' &&
        item.browserWindow === appWindow.win,
    ) as HistoryBookmarksDialog | undefined;
    dialog?.scheduleHoverHide();
  });

  ipcMain.on(`history-bookmarks-popup-close-${id}`, () => {
    const dialog = Application.instance.dialogs.persistentDialogs.find(
      (item) =>
        item.name === 'history-bookmarks-popup' &&
        item.browserWindow === appWindow.win,
    );
    dialog?.hide();
  });

  ipcMain.on(
    `history-bookmarks-popup-open-url-${id}`,
    (_e, url: string, target: 'current' | 'new' | 'background' = 'current') => {
      if (url) {
        if (target === 'current') {
          // ViewManager.selected is a main-process View; use its navigation
          // lifecycle so address bar state, extensions and special URLs stay in sync.
          appWindow.viewManager.selected?.load(url);
        } else {
          appWindow.viewManager.create({
            url,
            active: target === 'new',
          });
        }
      }
      const dialog = Application.instance.dialogs.persistentDialogs.find(
        (item) =>
          item.name === 'history-bookmarks-popup' &&
          item.browserWindow === appWindow.win,
      );
      dialog?.hide();
    },
  );

  ipcMain.on(
    `history-bookmarks-popup-open-manager-${id}`,
    (_e, kind: 'history' | 'bookmarks') => {
      appWindow.viewManager.create({
        url: getWebUIURL(kind),
        active: true,
      });
      const dialog = Application.instance.dialogs.persistentDialogs.find(
        (item) =>
          item.name === 'history-bookmarks-popup' &&
          item.browserWindow === appWindow.win,
      );
      dialog?.hide();
    },
  );

  // 弹窗选择语言:未开启则开启,已开启则 reload 按新 target 重译。
  ipcMain.handle(`translate-set-language-${id}`, (_e, code: string) => {
    appWindow.viewManager.selected?.changeTranslationTarget(code);
    return true;
  });

  // 弹窗「显示原文」:关闭翻译并 reload 回原文。
  ipcMain.handle(`translate-restore-${id}`, () => {
    appWindow.viewManager.selected?.stopTranslation();
    return true;
  });

  // ===== PWA 安装 =====
  // 小号的“添加到桌面”复用安装应用弹窗，统一选择添加位置和快捷方式图标。
  ipcMain.handle(
    `profile-shortcut-open-${id}`,
    async (_event, rawName: unknown) => {
      const info = getProfileShortcutDialogData(rawName);
      if (!info.ok || !info.name) return info;

      const installDialog = Application.instance.dialogs.getPersistent(
        'install-app',
      ) as InstallAppDialog;
      installDialogContext = { type: 'profile', name: info.name };
      await installDialog.openCentered(appWindow.win, {
        mode: 'profile',
        name: info.name,
        publisher: '小号快捷方式',
        iconUrl: info.iconUrl || '',
        fallbackIconUrl: '',
        installed: false,
      });
      return { ok: true };
    },
  );

  // QuickMenu「安装为 PWA」:对当前页同步收集信息 → 主进程构造可安装 manifest
  // (有原生 manifest 则主进程 fetch 解析;无则合成并注入 <link rel=manifest> 实现支持) →
  // 打开安装确认弹窗。确认/取消复用 pwa-install-confirm/cancel。
  // 注:页面侧只做纯同步收集,不在主世界返回 Promise(高活跃站点会让 executeJavaScript
  // 的等待结果丢失为 undefined),manifest fetch 移到主进程原生 fetch(不受 CSP/CORS 影响)。
  ipcMain.on(`quickmenu-install-pwa-${id}`, async () => {
    if (quickPwaOpening) return;
    const view = appWindow.viewManager.selected;
    if (!view || !view.webContents || view.webContents.isDestroyed()) return;
    const url = view.url || '';
    if (!/^(https?|file):\/\//i.test(url)) return; // 仅 http(s)/file 页面可安装(webui/内部页跳过)
    quickPwaOpening = true;
    try {
      // 1) 同步收集页面信息。部分高活跃页面(如抖音)会让 Electron 的
      // executeJavaScript Promise 永久不回包；同时尝试 mainFrame，并设短超时，
      // 避免菜单点击无响应。
      const attempts: Promise<any>[] = [
        view.webContents.executeJavaScript(COLLECT_PAGE_INFO_CODE, true),
      ];
      const mainFrameExec = view.webContents.mainFrame?.executeJavaScript;
      if (typeof mainFrameExec === 'function') {
        attempts.push(
          mainFrameExec.call(
            view.webContents.mainFrame,
            COLLECT_PAGE_INFO_CODE,
            true,
          ),
        );
      }
      const raw = await new Promise<any>((resolve) => {
        let settled = false;
        let remaining = attempts.length;
        const finish = (value?: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish(undefined), 1000);
        attempts.forEach((attempt) => {
          attempt.then(
            (value) => {
              if (value) finish(value);
              else if (--remaining === 0) finish(undefined);
            },
            () => {
              if (--remaining === 0) finish(undefined);
            },
          );
        });
      });
      console.log('[pwa] quickmenu collect', url, raw);
      let info: CollectedPageInfo | null = null;
      if (raw) {
        try {
          info = JSON.parse(raw);
        } catch {
          info = null;
        }
      }
      if (!info?.origin) {
        const parsedUrl = new URL(url);
        let title = '';
        try {
          title = view.webContents.getTitle() || '';
        } catch {
          title = '';
        }
        info = {
          title: title.trim(),
          host: parsedUrl.hostname.replace(/^www\./, ''),
          origin: parsedUrl.origin,
          pageUrl: url.split('#')[0],
          themeColor: '',
          manifestHref: '',
          favicons: view.favicon
            ? [{ href: view.favicon, type: '', size: 0, prio: 4 }]
            : [],
        };
        console.log('[pwa] quickmenu using main-process fallback', url);
      }
      // 2) 主进程构造可安装 manifest(原生 manifest 优先,否则合成)
      const { manifest, synthetic } = await buildInstallableManifest(info, url);
      if (
        appWindow.viewManager.selected !== view ||
        view.webContents.isDestroyed() ||
        view.url !== url
      ) {
        console.log('[pwa] quickmenu stale page discarded', url);
        return;
      }
      console.log(
        '[pwa] quickmenu manifest',
        url,
        'synthetic=' + synthetic,
        manifest.name,
        manifest.icon?.src,
      );
      // 3) 合成 manifest 注入页面(实现"注入 JS 使不支持页面获得 manifest"),fire-and-forget
      if (synthetic) {
        view.webContents
          .executeJavaScript(
            injectManifestCode(manifestToWebJson(manifest)),
            true,
          )
          .catch(() => {});
      }
      // 4) 赋值 + 打开弹窗
      view.pwaManifest = manifest;
      view.canInstallPwa = true; // 地址栏图标同步显示,状态一致
      view.pwaInstalled = isUrlInstalled(manifest.startUrl || url);
      let publisher = '';
      try {
        publisher = new URL(url).hostname || '';
      } catch {
        publisher = '';
      }
      const dialog = Application.instance.dialogs.getPersistent(
        'install-app',
      ) as InstallAppDialog;
      // 弹窗定位:主窗口顶部中央(QuickMenu 无地址栏锚点)
      const fallbackIconUrl = getPwaFallbackIcon(url, view.favicon);
      installDialogContext = {
        type: 'pwa',
        viewId: view.id,
        manifest,
        pageUrl: url,
        fallbackIconUrl,
        installing: false,
      };
      dialog.openCentered(appWindow.win, {
        mode: 'pwa',
        name: manifest.name || manifest.shortName || '应用',
        publisher,
        iconUrl: manifest.icon?.src || fallbackIconUrl,
        fallbackIconUrl,
        startUrl: manifest.startUrl,
        themeColor: manifest.themeColor || manifest.backgroundColor || '',
        installed: view.pwaInstalled,
      });
    } catch (e) {
      console.log('[pwa] quickmenu error', url, e);
    } finally {
      quickPwaOpening = false;
    }
  });

  // 地址栏安装图标点击:打开安装确认弹窗,下发 manifest 快照 + 图标 URL + 发布者。
  ipcMain.on(`pwa-install-open-${id}`, (_e, left: number, top: number) => {
    const view = appWindow.viewManager.selected;
    if (!view || !view.pwaManifest) return;
    const m = view.pwaManifest;
    let publisher = '';
    try {
      publisher = new URL(view.url).hostname || '';
    } catch {
      publisher = '';
    }
    const dialog = Application.instance.dialogs.getPersistent(
      'install-app',
    ) as InstallAppDialog;
    const fallbackIconUrl = getPwaFallbackIcon(view.url, view.favicon);
    installDialogContext = {
      type: 'pwa',
      viewId: view.id,
      manifest: m,
      pageUrl: view.url,
      fallbackIconUrl,
      installing: false,
    };
    dialog.open(appWindow.win, left, top, {
      mode: 'pwa',
      name: m.name || m.shortName || '应用',
      publisher,
      iconUrl: m.icon?.src || fallbackIconUrl,
      fallbackIconUrl,
      startUrl: m.startUrl,
      themeColor: m.themeColor || m.backgroundColor || '',
      installed: view.pwaInstalled,
    });
  });

  // 安装弹窗本地图标选择:主进程打开系统文件选择器并校验图片可解码,
  // 仅把缩小后的 data URL 用于预览,安装时继续使用原始本地路径。
  ipcMain.handle(`pwa-install-select-icon-${id}`, async () => {
    const result = await dialog.showOpenDialog(appWindow.win, {
      title:
        installDialogContext?.type === 'profile'
          ? '选择小号快捷方式图标'
          : '选择应用图标',
      properties: ['openFile'],
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'ico'],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    try {
      const image = nativeImage.createFromPath(path);
      if (image.isEmpty()) return null;
      return {
        path,
        dataUrl: image.resize({ width: 128, height: 128 }).toDataURL(),
      };
    } catch {
      return null;
    }
  });

  // 确认安装:开独立窗口 + 快捷方式 + 持久化,标记本站已安装,关闭弹窗。
  ipcMain.handle(
    `pwa-install-confirm-${id}`,
    async (
      _e,
      opts: { desktop: boolean; startMenu: boolean; localIconPath?: string },
    ) => {
      const context = installDialogContext;
      if (context?.type !== 'pwa') {
        return { ok: false, message: '安装操作已失效，请重新打开安装窗口' };
      }
      if (context.installing) {
        return { ok: false, message: '正在安装，请稍候' };
      }
      context.installing = true;
      try {
        await performInstall(context.manifest, context.pageUrl, {
          createDesktopShortcut: !!opts?.desktop,
          createStartMenu: !!opts?.startMenu,
          localIconPath: opts?.localIconPath,
          fallbackIconUrl: context.fallbackIconUrl,
        });
        const installedView = appWindow.viewManager.getById(context.viewId);
        if (installedView && isUrlInstalled(installedView.url)) {
          installedView.markPwaInstalled();
        }
      } catch (e) {
        context.installing = false;
        console.log('pwa install failed', e);
        return {
          ok: false,
          message: '安装失败，请检查磁盘或快捷方式目录权限后重试',
        };
      }
      // 持久弹窗可能在安装期间被另一页面重新打开。仅关闭本次请求对应的
      // 上下文，避免旧请求完成后清掉新页面的安装数据。
      if (installDialogContext === context) {
        const dialog = Application.instance.dialogs.getExistingPersistent(
          'install-app',
        ) as InstallAppDialog | undefined;
        installDialogContext = null;
        dialog?.hide();
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    `profile-shortcut-confirm-${id}`,
    async (_event, opts: IProfileShortcutOptions) => {
      if (installDialogContext?.type !== 'profile') {
        return { ok: false, message: '小号快捷方式操作已失效' };
      }
      const result = await createProfileShortcuts(
        installDialogContext.name,
        opts,
      );
      if (result.ok) {
        installDialogContext = null;
        const installDialog =
          Application.instance.dialogs.getExistingPersistent('install-app') as
            | InstallAppDialog
            | undefined;
        installDialog?.hide();
      }
      return result;
    },
  );

  // 取消 / 关闭:直接隐藏弹窗。
  ipcMain.on(`pwa-install-cancel-${id}`, () => {
    const dialog = Application.instance.dialogs.getExistingPersistent(
      'install-app',
    ) as InstallAppDialog | undefined;
    installDialogContext = null;
    dialog?.hide();
  });

  // QuickMenu 读取当前标签页缩放比例（菜单显示时拉取一次）
  ipcMain.handle(`get-selected-zoom-${id}`, () => {
    return appWindow.viewManager.selected?.webContents.zoomFactor ?? 1;
  });

  // QuickMenu 读取当前选中标签页 URL（菜单显示时拉取一次）
  // 用于判断「安装为 PWA」是否可用:http(s)/file 之外的内部页(yjllq://、chrome-extension:// 等)禁用。
  ipcMain.handle(`get-selected-url-${id}`, () => {
    return appWindow.viewManager.selected?.url ?? '';
  });

  // 渲染层启动时询问本窗口是否由标签撕离生成(若是则跳过默认新标签页,等待领养)。
  ipcMain.on(`is-pending-detach-${id}`, (e) => {
    e.returnValue = appWindow.pendingDetach;
  });

  // 渲染层启动时询问本窗口是否有外部请求打开的初始 URL(如「在新窗口打开链接」)。
  // startup-tabs 优先打开它,避免与默认 newtab 的 select 竞争导致新标签不被切换。
  ipcMain.on(`get-initial-url-${id}`, (e) => {
    e.returnValue = appWindow.initialUrl;
  });

  ipcMain.on(`restore-session-with-initial-url-${id}`, (e) => {
    e.returnValue = appWindow.restoreSessionWithInitialUrl;
  });

  // 工作区窗口启动时读取完整上下文,普通窗口返回 null。
  ipcMain.on(`get-workspace-context-${id}`, (e) => {
    e.returnValue = appWindow.workspace || null;
  });

  if (process.env.ENABLE_AUTOFILL) {
    type AutofillTarget = {
      label: string;
      hostname: string;
      url: string;
      main: boolean;
      execute: (code: string) => Promise<any>;
      focused?: boolean;
    };

    const getAutofillTargets = (view: any): AutofillTarget[] => {
      const targets: AutofillTarget[] = [];
      const addTarget = (
        label: string,
        rawUrl: string,
        main: boolean,
        execute: (code: string) => Promise<any>,
      ) => {
        try {
          const url = new URL(rawUrl);
          if (!/^https?:$/.test(url.protocol)) return;
          targets.push({
            label,
            hostname: url.hostname,
            url: `${url.origin}${url.pathname}`,
            main,
            execute,
          });
        } catch (error) {
          console.log('[autofill-debug] target URL ignored', {
            label,
            rawUrl,
            error: String(error),
          });
        }
      };

      addTarget('main', view.webContents.getURL(), true, (code) =>
        view.webContents.executeJavaScript(code, true),
      );
      for (const item of view.framesCache) {
        const frame = webFrameMain.fromId(
          item.frameProcessId,
          item.frameRoutingId,
        );
        if (!frame) continue;
        addTarget(`frame ${frame.url}`, frame.url, false, (code) =>
          frame.executeJavaScript(code, true),
        );
      }
      return targets;
    };

    const orderAutofillTargets = async (targets: AutofillTarget[]) => {
      const focusProbe = `(function(){var e=document.activeElement;return !!(e&&e.tagName==='INPUT'&&e.type!=='hidden');})()`;
      await Promise.all(
        targets.map(async (target) => {
          try {
            target.focused = !!(await target.execute(focusProbe));
          } catch (error) {
            target.focused = false;
            console.log('[autofill-debug] focus probe failed', {
              target: target.label,
              url: target.url,
              error: String(error),
            });
          }
        }),
      );
      const focusedTargets = targets.filter((target) => target.focused);
      const ordered = (focusedTargets.length ? focusedTargets : targets).sort(
        (left, right) => Number(right.main) - Number(left.main),
      );
      console.log('[autofill-debug] target focus order', {
        usedFocusedOnly: focusedTargets.length > 0,
        all: targets.map(({ label, hostname, url, main, focused }) => ({
          label,
          hostname,
          url,
          main,
          focused,
        })),
        ordered: ordered.map((target) => target.label),
      });
      return ordered;
    };

    const showAutofillToast = async (view: any, message: string) => {
      if (!view || view.webContents.isDestroyed()) return;
      try {
        const { getAutofillToastCode } = await import(
          /* webpackChunkName: "on-demand-autofill-toast" */
          '~/main/services/autofill-toast'
        );
        if (view.webContents.isDestroyed()) return;
        await view.webContents.executeJavaScript(
          getAutofillToastCode(message),
          true,
        );
      } catch (error) {
        console.log('[autofill-toast] inject failed', error);
      }
    };

    ipcMain.on(
      `autofill-open-${id}`,
      async (_event, right: number, bottom: number) => {
        if (!Application.instance.settings.object.autofill) return;
        const view = appWindow.viewManager.selected;
        if (!view || view.webContents.isDestroyed()) return;
        const viewId = view.id;
        const targets = getAutofillTargets(view);
        const all = await Application.instance.storage.find<IFormFillData>({
          scope: 'formfill',
          query: { type: 'password' },
        });
        if (appWindow.viewManager.selected?.id !== viewId) return;

        console.log('[autofill-debug] open picker', {
          windowId: id,
          viewId,
          page: view.webContents.getURL(),
          cachedFrameCount: view.framesCache?.length || 0,
          targets: targets.map(({ label, hostname, url, main }) => ({
            label,
            hostname,
            url,
            main,
          })),
          credentialCount: all.length,
        });

        const seen = new Set<string>();
        const matched = all.filter((record) => {
          if (!record?._id || !record.url || seen.has(record._id)) return false;
          const match = targets.some((target) =>
            hostMatches(record.url, target.hostname),
          );
          if (match) seen.add(record._id);
          return match;
        });
        console.log('[autofill-debug] picker matches', {
          matchedCount: matched.length,
          matched: matched.map((record) => ({
            id: record._id,
            storedUrl: record.url,
            hasUsername: !!(record.fields?.username || record.fields?.email),
            hasPassword: !!record.fields?.password,
          })),
        });
        if (!matched.length) {
          Application.instance.dialogs.persistentDialogs
            .find((item) => item.name === 'form-fill')
            ?.hide();
          return;
        }

        const items = matched.map((record) => {
          let host = record.url || '';
          try {
            host = new URL(host.includes('://') ? host : `https://${host}`)
              .hostname;
          } catch {}
          const passwordLength =
            record.fields?.passLength || record.fields?.password?.length || 0;
          return {
            _id: record._id,
            text: record.fields?.username || record.fields?.email || '无用户名',
            passwordMask: '•'.repeat(Math.min(Math.max(passwordLength, 4), 12)),
            host,
          };
        });

        const dialog = Application.instance.dialogs.getPersistent(
          'form-fill',
        ) as FormFillDialog;
        await dialog.open(appWindow.win, right, bottom, items);
      },
    );

    // 图标与密码列表弹窗属于两个 webContents。离开图标后延迟关闭，弹窗的
    // mouseenter 会取消计时器，只在两边都离开后收起。
    ipcMain.on(`autofill-hover-leave-${id}`, () => {
      const dialog = Application.instance.dialogs.persistentDialogs.find(
        (item) => item.name === 'form-fill',
      ) as FormFillDialog | undefined;
      if (dialog?.browserWindow === appWindow.win) dialog.scheduleHoverHide();
    });

    ipcMain.handle(`autofill-fill-${id}`, async (_event, recordId: string) => {
      if (!Application.instance.settings.object.autofill || !recordId) {
        console.log('[autofill-debug] fill rejected', {
          enabled: !!Application.instance.settings.object.autofill,
          hasRecordId: !!recordId,
        });
        return false;
      }
      const view = appWindow.viewManager.selected;
      if (!view || view.webContents.isDestroyed()) {
        console.log('[autofill-debug] fill rejected: no active view', {
          hasView: !!view,
          destroyed: !!view?.webContents?.isDestroyed(),
        });
        return false;
      }
      const record = await Application.instance.storage.findOne<IFormFillData>({
        scope: 'formfill',
        query: { _id: recordId, type: 'password' },
      });
      if (!record?.url) {
        console.log('[autofill-debug] fill rejected: credential missing', {
          recordId,
          found: !!record,
          hasUrl: !!record?.url,
        });
        return false;
      }

      const allTargets = getAutofillTargets(view);
      const targets = allTargets.filter((target) =>
        hostMatches(record.url, target.hostname),
      );
      console.log('[autofill-debug] fill start', {
        recordId,
        storedUrl: record.url,
        hasUsername: !!(record.fields?.username || record.fields?.email),
        hasPassword: !!record.fields?.password,
        page: view.webContents.getURL(),
        allTargets: allTargets.map(({ label, hostname, url, main }) => ({
          label,
          hostname,
          url,
          main,
          hostMatched: hostMatches(record.url, hostname),
        })),
        matchedTargetCount: targets.length,
      });
      const ordered = await orderAutofillTargets(targets);
      const { buildAutofillPickerCode } = await import(
        /* webpackChunkName: "on-demand-autofill-picker" */
        '~/main/services/autofill-picker'
      );
      for (const target of ordered) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const result = await target.execute(
              buildAutofillPickerCode([record], {
                bind: false,
                showImmediately: true,
                fillSingleImmediately: true,
              }),
            );
            console.log('[autofill-debug] picker result', {
              target: target.label,
              hostname: target.hostname,
              url: target.url,
              attempt: attempt + 1,
              result,
            });
            if (result?.ok) {
              console.log('[autofill-debug] fill succeeded', {
                recordId,
                target: target.label,
                attempt: attempt + 1,
              });
              void showAutofillToast(view, '账号密码已填充');
              return true;
            }
            // 网易 URS asynchronously mounts its inputs after the iframe
            // itself is ready. Give the frame a couple of short render turns.
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 80));
            }
          } catch (error) {
            console.log('[autofill-debug] picker execution failed', {
              target: target.label,
              hostname: target.hostname,
              url: target.url,
              attempt: attempt + 1,
              error: String(error),
            });
            break;
          }
        }
      }
      console.log('[autofill-debug] fill failed: no target accepted form', {
        recordId,
        matchedTargetCount: targets.length,
        attemptedTargets: ordered.map((target) => target.label),
      });
      void showAutofillToast(view, '未识别到可填充的登录表单');
      return false;
    });

    ipcMain.handle(
      `find-form-fill-update-${id}`,
      async (e, pageHostname?: string) => {
        if (!Application.instance.settings.object.autofill) {
          return null;
        }
        // 优先用页面自报的 hostname(preload 经 invoke 参数传入):准确、不受
        // selected tab 切换或 load 瞬间 selected 尚未切换影响;回退到 selected.url。
        let hostname = pageHostname || '';
        if (!hostname) {
          const url = appWindow.viewManager.selected?.url || '';
          hostname = parse(url).hostname;
        }
        if (!hostname) return null;

        // 域名级匹配:取本站全部候选(passport.x.com ↔ x.com 也算同站),
        // 精确 host 优先,供 preload 做多账号下拉。对齐鸿蒙 host LIKE %host% 思路。
        const all = await Application.instance.storage.find<IFormFillData>({
          scope: 'formfill',
          query: { type: 'password' },
        });
        const matched = all.filter(
          (r) => r && r.url && hostMatches(r.url, hostname),
        );
        console.log(
          '[autofill] find host=',
          hostname,
          'total=',
          all.length,
          'matched=',
          matched.length,
        );
        if (matched.length === 0) return null;

        matched.sort(
          (a, b) =>
            Number(!hasSameHostname(a.url, hostname)) -
            Number(!hasSameHostname(b.url, hostname)),
        );
        // 兼容旧调用方:既返回数组,首个仍是最佳匹配
        return matched;
      },
    );

    ipcMain.on(`check-form-autofill-${id}`, async () => {
      console.log('check-form-autofill-event');
      if (!Application.instance.settings.object.autofill) {
        return;
      }
      const view = appWindow.viewManager.selected;
      let toastMessage = '当前网站没有可填充的账号密码';

      if (view && !view.webContents.isDestroyed()) {
        try {
          const all = await Application.instance.storage.find<IFormFillData>({
            scope: 'formfill',
            query: { type: 'password' },
          });
          type FillTarget = {
            label: string;
            hostname: string;
            main: boolean;
            execute: (code: string) => Promise<any>;
            focused?: boolean;
          };
          const targets: FillTarget[] = [];
          const addTarget = (
            label: string,
            rawUrl: string,
            main: boolean,
            execute: (code: string) => Promise<any>,
          ) => {
            try {
              const url = new URL(rawUrl);
              if (!/^https?:$/.test(url.protocol)) return;
              targets.push({ label, hostname: url.hostname, main, execute });
            } catch {}
          };
          addTarget('main', view.webContents.getURL(), true, (code) =>
            view.webContents.executeJavaScript(code, true),
          );
          const seenFrames = new Set<string>();
          for (const item of view.framesCache) {
            const frameKey = `${item.frameProcessId}:${item.frameRoutingId}`;
            if (seenFrames.has(frameKey)) continue;
            seenFrames.add(frameKey);
            const frame = webFrameMain.fromId(
              item.frameProcessId,
              item.frameRoutingId,
            );
            if (!frame) continue;
            addTarget(`frame ${frame.url}`, frame.url, false, (code) =>
              frame.executeJavaScript(code, true),
            );
          }

          const focusProbe = `(function(){var e=document.activeElement;return !!(e&&e.tagName==='INPUT'&&e.type!=='hidden');})()`;
          await Promise.all(
            targets.map(async (target) => {
              try {
                target.focused = !!(await target.execute(focusProbe));
              } catch {
                target.focused = false;
              }
            }),
          );
          const focusedTargets = targets.filter((target) => target.focused);
          const ordered = (
            focusedTargets.length ? focusedTargets : targets
          ).sort((left, right) => Number(right.main) - Number(left.main));

          let filledAny = false;
          let hadCredentials = false;
          const { buildAutofillPickerCode } = await import(
            /* webpackChunkName: "on-demand-autofill-picker" */
            '~/main/services/autofill-picker'
          );
          for (const target of ordered) {
            const matched = all
              .filter(
                (record) =>
                  record?.url && hostMatches(record.url, target.hostname),
              )
              .sort(
                (left, right) =>
                  Number(!hasSameHostname(left.url, target.hostname)) -
                  Number(!hasSameHostname(right.url, target.hostname)),
              );
            if (!matched.length) continue;
            hadCredentials = true;
            try {
              const result = await target.execute(
                buildAutofillPickerCode(matched, {
                  bind: false,
                  showImmediately: true,
                  fillSingleImmediately: true,
                }),
              );
              console.log(
                '[autofill] frame',
                target.label,
                '->',
                result ? JSON.stringify(result) : 'null',
              );
              if (result?.ok) {
                filledAny = true;
                toastMessage =
                  result.action === 'picker'
                    ? '请选择要填充的账号'
                    : '账号密码已填充';
                break;
              }
            } catch (error) {
              console.log('[autofill] frame err', target.label, String(error));
            }
          }
          if (!filledAny) {
            toastMessage = hadCredentials
              ? '未识别到可填充的登录表单'
              : '当前网站没有可填充的账号密码';
          }
        } catch (err) {
          console.log('[autofill] check error', err);
          toastMessage = '自动填充失败，请稍后重试';
        }
      }

      // 钥匙图标点击反馈:在当前页注入轻量 toast。
      // renderer DOM 无法盖住页面 BrowserView,故注入到页面里(Shadow DOM 隔离 + 点击穿透)
      if (view && !view.webContents.isDestroyed()) {
        void showAutofillToast(view, toastMessage);
      }
    });

    ipcMain.on(`credentials-show-${id}`, (event, data) => {
      requestCredentialPromptFromPage(appWindow, event, data);
    });

    ipcMain.on(`credentials-hide-${id}`, (event) => {
      hideCredentialPrompt(event, id);
    });

    ipcMain.on(`credentials-save-${id}`, (event, data) => {
      saveCredentialPrompt(event, id, data);
    });

    ipcMain.on(`credentials-remove-${id}`, async (e, data: IFormFillData) => {
      const { _id } = data;
      if (!_id) return;
      const credentialsDialog =
        Application.instance.dialogs.getExistingPersistent(
          'credentials',
        ) as any;
      if (
        !credentialsDialog ||
        credentialsDialog.webContents.isDestroyed() ||
        e.sender.id !== credentialsDialog.webContents.id ||
        credentialsDialog.browserWindow?.id !== id
      ) {
        return;
      }

      await Application.instance.storage.remove({
        scope: 'formfill',
        query: {
          _id,
        },
      });

      const settingsView = appWindow.viewManager.settingsView;
      if (settingsView && !settingsView.webContents.isDestroyed()) {
        settingsView.webContents.send('credentials-remove', _id);
      }
      const credentials =
        await Application.instance.storage.find<IFormFillData>({
          scope: 'formfill',
          query: { type: 'password' },
        });
      for (const owner of Application.instance.windows.list) {
        for (const view of owner.viewManager.views.values()) {
          if (view.incognito || view.webContents.isDestroyed()) continue;
          view.webContents.send('credentials-reload-page');
          await view.refreshAutofillPickers(credentials);
          await view.updateCredentials();
        }
      }
    });

    // 页内下拉删除某条密码(按 _id),删除后通知设置页同步移除
    ipcMain.on(`credentials-delete-${id}`, async (e, recordId: string) => {
      if (!recordId) return;
      const sourceView = appWindow.viewManager.findViewByWebContentsId(
        e.sender.id,
      );
      if (!sourceView) return;
      const record = await Application.instance.storage.findOne<IFormFillData>({
        scope: 'formfill',
        query: { _id: recordId },
      });
      if (
        !record ||
        !record.url ||
        !hostMatches(record.url, sourceView.hostname)
      ) {
        return;
      }
      await Application.instance.storage.remove({
        scope: 'formfill',
        query: { _id: recordId },
      });
      const sv = appWindow.viewManager.settingsView;
      if (sv && !sv.webContents.isDestroyed()) {
        sv.webContents.send('credentials-remove', recordId);
      }
      await sourceView.refreshAutofillPickers();
    });

    // 页内下拉「去管理」:打开 设置-密码填充
    ipcMain.on(`open-password-settings-${id}`, () => {
      appWindow.viewManager.create({
        url: `${getWebUIURL('settings')}?section=autofill`,
        active: true,
      });
    });
  }

  // ── 书签栏文件夹/「更多按钮」书签浮层(独立 BrowserView) ──
  // 两个入口按可用空间多列展开，列表项都支持右键菜单。
  let overflowAllBookmarks: IBookmark[] = [];
  const getOverflow = () =>
    Application.instance.dialogs.getPersistent('bookmark-overflow') as
      | BookmarkOverflowDialog
      | undefined;
  const getExistingOverflow = () =>
    Application.instance.dialogs.getExistingPersistent('bookmark-overflow') as
      | BookmarkOverflowDialog
      | undefined;

  // 当前展开的原生子文件夹菜单,用于 hover 保持 / click toggle。
  // 原生 Menu 的开关状态浮层感知不到,由主进程统一跟踪;开/关浮层时清空。
  let folderMenu: { menu: Electron.Menu; folderId: string } | null = null;
  const closeFolderMenu = () => {
    if (!folderMenu) return;
    try {
      folderMenu.menu.closePopup(appWindow.win);
    } catch {
      // 菜单已关/销毁,忽略
    }
    folderMenu = null;
  };
  const openFolderMenu = async (folderId: string, x: number, y: number) => {
    closeFolderMenu();
    const menu = await bookmarkMenu.createDropdown(
      appWindow,
      folderId,
      overflowAllBookmarks,
      {},
    );
    folderMenu = { menu, folderId };
    menu.popup({ window: appWindow.win, x: Math.floor(x), y: Math.floor(y) });
  };

  ipcMain.handle(
    `show-bookmarks-bar-overflow-${id}`,
    (
      event,
      items: IBookmark[],
      allBookmarks: IBookmark[],
      {
        x,
        y,
        ...options
      }: { x: number; y: number } & BookmarkOverflowOpenOptions,
    ) => {
      overflowAllBookmarks = allBookmarks || [];
      closeFolderMenu(); // 开浮层时清掉上一会话残留的子菜单状态
      void getOverflow()
        ?.open(
          appWindow.win,
          Math.floor(x),
          Math.floor(y),
          items,
          overflowAllBookmarks,
          options,
        )
        .catch((error) =>
          console.error('[bookmarks] open bookmark dialog failed', error),
        );
    },
  );

  // hover 文件夹 → 弹子菜单(同 folderId 已开则保持,不重复弹)
  ipcMain.on(
    `bookmark-overflow-folder-hover-${id}`,
    async (event, folderId: string, x: number, y: number) => {
      if (folderMenu && folderMenu.folderId === folderId) return;
      await openFolderMenu(folderId, x, y);
    },
  );

  // click 文件夹 → toggle(已开则关,未开则弹)
  ipcMain.on(
    `bookmark-overflow-folder-click-${id}`,
    async (event, folderId: string, x: number, y: number) => {
      if (folderMenu && folderMenu.folderId === folderId) {
        closeFolderMenu();
      } else {
        await openFolderMenu(folderId, x, y);
      }
    },
  );

  // 打开网页书签 / Esc → 关闭浮层(连同子菜单)
  ipcMain.on(`bookmark-overflow-close-all-${id}`, () => {
    closeFolderMenu();
    getExistingOverflow()?.hide();
  });

  ipcMain.handle(
    `show-bookmarks-bar-dropdown-${id}`,
    async (
      event,
      folderId: string,
      bookmarks: IBookmark[],
      { x, y, df, dp }: { x: number; y: number; df?: string; dp?: string },
    ) => {
      const menu = await bookmarkMenu.createDropdown(
        appWindow,
        folderId,
        bookmarks,
        {
          df,
          dp,
        },
      );
      menu.popup({ x: Math.floor(x), y: Math.floor(y), window: appWindow.win });
    },
  );
  ipcMain.handle(
    `show-bookmarks-bar-context-menu-${id}`,
    (
      event,
      item?: IBookmark | null,
      source: 'bar' | 'manager' = 'bar',
      barFolderId?: string,
    ) => {
      bookmarkMenu
        .createMenu(appWindow, item, source, barFolderId)
        .popup({ window: appWindow.win });
    },
  );
};
