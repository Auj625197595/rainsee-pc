import {BrowserWindow, ipcMain} from 'electron';
import {parse} from 'url';
//import { getPassword, setPassword, deletePassword } from 'keytar';

import {AppWindow} from '../windows';
import {Application} from '../application';
import {MenuDialog} from '../dialogs/menu';
import {ExtensionsListDialog} from '../dialogs/extensions-list';
import {PreviewDialog} from '../dialogs/preview';
import {TabGroupPreviewDialog} from '../dialogs/tabgroup-preview';
import {SidebarPanelDialog} from '../dialogs/sidebar-panel';
import {IFormFillData, IBookmark} from '~/interfaces';
import {hostMatches, extractSearchQuery} from '~/utils/url';
import {SearchDialog} from '../dialogs/search';

import * as bookmarkMenu from '../menus/bookmarks';
import {printPage} from '../menus/common-actions';
import {showFindDialog} from '../dialogs/find';
import {getFormFillMenuItems} from '../utils';
import {AddBookmarkDialog} from '../dialogs/add-bookmark';
import {showExtensionDialog} from '../dialogs/extension-popup';
import {showDownloadsDialog} from '../dialogs/downloads';
import {showZoomDialog} from '../dialogs/zoom';
import {SearchEnginesDialog} from '../dialogs/search-engines';
import {TranslateDialog} from '../dialogs/translate';
import {InstallAppDialog} from '../dialogs/install-app';
import {performInstall, isUrlInstalled, COLLECT_PAGE_INFO_CODE, buildInstallableManifest, injectManifestCode, manifestToWebJson, CollectedPageInfo} from './pwa';
import {showTabGroupDialog} from '../dialogs/tabgroup';
import {ShowBlockDialog} from "~/main/dialogs/show-block";
import {ShareDialog} from "~/main/dialogs/share";
import {ScreenshotDialog} from "~/main/dialogs/screenshot";
import {UpdateDialog} from "~/main/dialogs/update";
import {showVideoDialog} from "~/main/dialogs/show-video";
import {showMediaPlayer} from "~/main/windows/media-player";
import {BookmarkOverflowDialog} from '../dialogs/bookmark-overflow';
import {getAdblockPickerCode} from "~/main/services/adblock-picker";
import {getAutofillToastCode} from "~/main/services/autofill-toast";
import {saveAdblockRule} from "~/main/services/adblock";
import {getWebUIURL} from "~/common/webui-main";

export const runMessagingService = (appWindow: AppWindow) => {
  const {id} = appWindow;

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
  ipcMain.on(`show-share-dialog-${id}`, (e, payload?: { url?: string; title?: string }) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'share',
    ) as ShareDialog;
    dialog.open(appWindow.win, payload);
  });

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
    const text =
      typeof data?.text === 'string' ? data.text.slice(0, 2048) : '';
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

  // hover 预加载:按钮 hover 时后台创建弹窗(不显示),click 时秒开。已存在则 no-op。
  // 仅对 disposable 名单的弹窗(search-engines/bookmark-overflow/extensions-list 等)有意义。
  ipcMain.on(`preload-dialog-on-hover-${id}`, (_e, name: string) => {
    Application.instance.dialogs.preloadOnHover(name);
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
    const dialog = Application.instance.dialogs.getPersistent(
      'preview',
    ) as PreviewDialog;
    dialog.hide();
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
    const dialog = Application.instance.dialogs.getPersistent(
      'tabgroup-preview',
    ) as TabGroupPreviewDialog;
    dialog.hide();
  });

  // 刷新已打开弹窗的内容/位置(关闭/重排后),绕开 show() 的 visible 守卫。
  ipcMain.on(`refresh-tabgroup-preview-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'tabgroup-preview',
    ) as TabGroupPreviewDialog;
    if (!dialog.visible) return;
    dialog.payload = payload;
    dialog.rearrange();
    dialog.send('visible', true, payload);
  });

  // 弹窗(独立 webContents)→ 宿主:交互动作与鼠标进出。按发送者 webContents
  // 反查其所属窗口,再转发到该窗口的 app.html。
  const forwardToOwner = (
    senderId: number,
    channel: string,
    payload?: any,
  ) => {
    const dlg = Application.instance.dialogs.persistentDialogs.find(
      (d: any) => d.name === 'tabgroup-preview' && d.webContents.id === senderId,
    ) as TabGroupPreviewDialog | undefined;
    const owner = dlg
      ? Application.instance.windows.fromBrowserWindow(dlg.browserWindow)
      : undefined;
    if (owner) owner.send(channel, payload);
  };

  ipcMain.on('tabgroup-preview-action', (e, payload) => {
    forwardToOwner(e.sender.id, 'tabgroup-preview-action', payload);
  });
  ipcMain.on('tabgroup-preview-enter', (e) => {
    forwardToOwner(e.sender.id, 'tabgroup-preview-enter');
  });
  ipcMain.on('tabgroup-preview-leave', (e) => {
    forwardToOwner(e.sender.id, 'tabgroup-preview-leave');
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
    const dialog = Application.instance.dialogs.getPersistent(
      'sidebar-panel',
    ) as SidebarPanelDialog;
    dialog.hide();
  });

  // 刷新已打开浮层的内容/位置(标签增删/选中/标题变化后),绕开 show() 的守卫。
  ipcMain.on(`refresh-sidebar-panel-${id}`, (e, payload) => {
    const dialog = Application.instance.dialogs.getPersistent(
      'sidebar-panel',
    ) as SidebarPanelDialog;
    if (!dialog.visible) return;
    dialog.payload = payload;
    dialog.rearrange();
    dialog.bringToTop();
    dialog.send('visible', true, payload);
  });

  // 浮层(独立 webContents)→ 宿主:交互动作与鼠标进出。
  const forwardToPanelOwner = (
    senderId: number,
    channel: string,
    payload?: any,
  ) => {
    const dlg = Application.instance.dialogs.persistentDialogs.find(
      (d: any) => d.name === 'sidebar-panel' && d.webContents.id === senderId,
    ) as SidebarPanelDialog | undefined;
    const owner = dlg
      ? Application.instance.windows.fromBrowserWindow(dlg.browserWindow)
      : undefined;
    if (owner) owner.send(channel, payload);
  };

  ipcMain.on('sidebar-panel-action', (e, payload) => {
    forwardToPanelOwner(e.sender.id, 'sidebar-panel-action', payload);
  });
  ipcMain.on('sidebar-panel-enter', (e) => {
    forwardToPanelOwner(e.sender.id, 'sidebar-panel-enter');
  });
  ipcMain.on('sidebar-panel-leave', (e) => {
    forwardToPanelOwner(e.sender.id, 'sidebar-panel-leave');
  });

  const clearTabHover = () => {
    appWindow.send('clear-tab-hover');
    const dialog = Application.instance.dialogs.getPersistent(
      'preview',
    ) as PreviewDialog;
    dialog.hide();
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
  ipcMain.on(`start-adblock-picker-${id}`, () => {
    const view = appWindow.viewManager.selected;
    if (!view || view.webContents.isDestroyed()) return;
    try {
      view.webContents.focus();
      view.webContents
        .executeJavaScript(getAdblockPickerCode(appWindow.win.id), true)
        .catch((err) => console.log('[adblock-picker] inject failed', err));
    } catch (err) {
      console.log('[adblock-picker] inject error', err);
    }
  });

  // picker 状态回传(进入/取消/提交), 目前仅记录日志, 预留给后续 UI 反馈
  ipcMain.on(`adblock-picker-state-${id}`, (e, state: string, rule?: string) => {
    console.log('[adblock-picker] state', state, rule || '');
  });

  // picker 生成的规则: 持久化并即时生效
  ipcMain.on(`save-adblock-rule-${id}`, async (e, rule: string) => {
    const view = appWindow.viewManager.selected;
    await saveAdblockRule(rule, view);
  });

  ipcMain.on(`show-adblock-rule-${id}`, (event)=> {
    console.log("show-adblock-rule-");
    appWindow.win.webContents.send("show-adblock-rule");
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

  // 切换默认搜索引擎并持久化;若当前页是旧引擎的搜索结果页,
  // 取出搜索词用新引擎重新搜索(在主进程统一处理,设置变更会自动广播到各窗口)。
  ipcMain.handle(`switch-search-engine-${id}`, (e, index: number) => {
    const settings = Application.instance.settings;
    const {searchEngines, searchEngine: prevIndex} = settings.object;

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

    settings.updateSettings({searchEngine: index});

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

  // 地址栏翻译图标点击:未翻译则自动开启,随后打开语言选择弹窗(携带当前 active/target)。
  ipcMain.on(`translate-open-${id}`, (_e, left: number, top: number) => {
    const view = appWindow.viewManager.selected;
    if (!view) return;
    if (!view.translateActive) {
      view.startTranslation();
    }
    const dialog = Application.instance.dialogs.getPersistent(
      'translate',
    ) as TranslateDialog;
    dialog.open(appWindow.win, left, top, {
      active: view.translateActive,
      target: view.translateTarget,
    });
  });

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
  // 检测到可安装 PWA 时条件预热安装弹窗(渲染端收到 pwa-installable 后触发),
  // 使首次点击安装图标即秒开;不可安装页面不浪费一个 React 包的加载。
  ipcMain.on(`warmup-install-app-${id}`, () => {
    Application.instance.dialogs.warmUpInstallAppDialog();
  });

  // QuickMenu「安装为 PWA」:对当前页同步收集信息 → 主进程构造可安装 manifest
  // (有原生 manifest 则主进程 fetch 解析;无则合成并注入 <link rel=manifest> 实现支持) →
  // 打开安装确认弹窗。确认/取消复用 pwa-install-confirm/cancel。
  // 注:页面侧只做纯同步收集,不在主世界返回 Promise(高活跃站点会让 executeJavaScript
  // 的等待结果丢失为 undefined),manifest fetch 移到主进程原生 fetch(不受 CSP/CORS 影响)。
  ipcMain.on(`quickmenu-install-pwa-${id}`, async () => {
    const view = appWindow.viewManager.selected;
    if (!view || !view.webContents || view.webContents.isDestroyed()) return;
    const url = view.url || '';
    if (!/^https?:\/\//i.test(url)) return; // 仅 http(s) 页面可安装(webui/内部页跳过)
    try {
      // 1) 同步收集页面信息(无 Promise/fetch,必然返回 JSON)
      const raw = await view.webContents.executeJavaScript(COLLECT_PAGE_INFO_CODE, true);
      console.log('[pwa] quickmenu collect', url, raw);
      if (!raw) return;
      const info: CollectedPageInfo = JSON.parse(raw);
      if (!info || !info.origin) return;
      // 2) 主进程构造可安装 manifest(原生 manifest 优先,否则合成)
      const {manifest, synthetic} = await buildInstallableManifest(info, url);
      console.log('[pwa] quickmenu manifest', url, 'synthetic=' + synthetic, manifest.name, manifest.icon?.src);
      // 3) 合成 manifest 注入页面(实现"注入 JS 使不支持页面获得 manifest"),fire-and-forget
      if (synthetic) {
        view.webContents
          .executeJavaScript(injectManifestCode(manifestToWebJson(manifest)), true)
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
      Application.instance.dialogs.warmUpInstallAppDialog();
      const dialog = Application.instance.dialogs.getPersistent(
        'install-app',
      ) as InstallAppDialog;
      // 弹窗定位:主窗口顶部中央(QuickMenu 无地址栏锚点)
      const b = appWindow.win.getBounds();
      const x = Math.round(b.x + b.width / 2);
      const y = Math.round(b.y + 90);
      dialog.open(appWindow.win, x, y, {
        name: manifest.name || manifest.shortName || '应用',
        publisher,
        iconUrl: manifest.icon?.src || '',
        startUrl: manifest.startUrl,
        themeColor: manifest.themeColor || manifest.backgroundColor || '',
        installed: view.pwaInstalled,
      });
    } catch (e) {
      console.log('[pwa] quickmenu error', url, e);
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
    dialog.open(appWindow.win, left, top, {
      name: m.name || m.shortName || '应用',
      publisher,
      iconUrl: m.icon?.src || '',
      startUrl: m.startUrl,
      themeColor: m.themeColor || m.backgroundColor || '',
      installed: view.pwaInstalled,
    });
  });

  // 确认安装:开独立窗口 + 快捷方式 + 持久化,标记本站已安装,关闭弹窗。
  ipcMain.handle(
    `pwa-install-confirm-${id}`,
    async (_e, opts: {desktop: boolean; startMenu: boolean}) => {
      const view = appWindow.viewManager.selected;
      if (!view || !view.pwaManifest) return false;
      const m = view.pwaManifest;
      try {
        await performInstall(m, view.url, {
          createDesktopShortcut: !!opts?.desktop,
          createStartMenu: !!opts?.startMenu,
        });
        view.markPwaInstalled();
      } catch (e) {
        console.log('pwa install failed', e);
      }
      const dialog = Application.instance.dialogs.getPersistent(
        'install-app',
      ) as InstallAppDialog;
      dialog.hide();
      return true;
    },
  );

  // 取消 / 关闭:直接隐藏弹窗。
  ipcMain.on(`pwa-install-cancel-${id}`, () => {
    const dialog = Application.instance.dialogs.getPersistent(
      'install-app',
    ) as InstallAppDialog;
    dialog.hide();
  });

  // QuickMenu 读取当前标签页缩放比例（菜单显示时拉取一次）
  ipcMain.handle(`get-selected-zoom-${id}`, () => {
    return appWindow.viewManager.selected?.webContents.zoomFactor ?? 1;
  });

  // 渲染层启动时询问本窗口是否由标签撕离生成(若是则跳过默认新标签页,等待领养)。
  ipcMain.on(`is-pending-detach-${id}`, (e) => {
    e.returnValue = appWindow.pendingDetach;
  });

  if (process.env.ENABLE_AUTOFILL) {
    // TODO: autofill
    // ipcMain.on(`form-fill-show-${id}`, async (e, rect, name, value) => {
    //   const items = await getFormFillMenuItems(name, value);

    //   if (items.length) {
    //     appWindow.dialogs.formFillDialog.send(`formfill-get-items`, items);
    //     appWindow.dialogs.formFillDialog.inputRect = rect;

    //     appWindow.dialogs.formFillDialog.resize(
    //       items.length,
    //       items.find((r) => r.subtext) != null,
    //     );
    //     appWindow.dialogs.formFillDialog.rearrange();
    //     appWindow.dialogs.formFillDialog.show(false);
    //   } else {
    //     appWindow.dialogs.formFillDialog.hide();
    //   }
    // });

    // ipcMain.on(`form-fill-hide-${id}`, () => {
    //   appWindow.dialogs.formFillDialog.hide();
    // });

    ipcMain.handle(
      `find-form-fill-update-${id}`,
      async (e) => {
        if (!Application.instance.settings.object.autofill) {
          return null;
        }
        const url = appWindow.viewManager.selected.url;
        const {hostname} = parse(url);
        if (!hostname) return null;

        // 域名级匹配:取本站全部候选(passport.x.com ↔ x.com 也算同站),
        // 精确 host 优先,供 preload 做多账号下拉。对齐鸿蒙 host LIKE %host% 思路。
        const all = await Application.instance.storage.find<IFormFillData>({
          scope: 'formfill',
          query: {type: 'password'},
        });
        const matched = all.filter(
          (r) => r && r.url && hostMatches(r.url, hostname),
        );
        if (matched.length === 0) return null;

        matched.sort((a, b) => {
          const ax = a.url === hostname ? 0 : 1;
          const bx = b.url === hostname ? 0 : 1;
          return ax - bx;
        });
        // 兼容旧调用方:既返回数组,首个仍是最佳匹配
        return matched;
      },
    );

    ipcMain.on(
      `check-form-autofill-${id}`,
      async (e) => {
        console.log("check-form-autofill-event");
        if (!Application.instance.settings.object.autofill) {
          return;
        }
        const view = appWindow.viewManager.selected;
        view?.send(`check-form-autofill`);

        // 钥匙图标点击反馈:在当前页注入轻量 toast("已尝试自动填充...")
        // renderer DOM 无法盖住页面 BrowserView,故注入到页面里(Shadow DOM 隔离 + 点击穿透)
        if (view && !view.webContents.isDestroyed()) {
          try {
            view.webContents
              .executeJavaScript(getAutofillToastCode(), true)
              .catch((err) => console.log('[autofill-toast] inject failed', err));
          } catch (err) {
            console.log('[autofill-toast] inject error', err);
          }
        }
      },
    );

    const saveCredentials = async (data: any) => {
      if (!Application.instance.settings.object.autofill) {
        return
      }
      const {username, password, oldUsername} = data;
      const view = appWindow.viewManager.selected;
      // Chrome 无痕模式可使用已有密码，但不会把新输入的表单信息写入密码库。
      if (!view || view.incognito) return;
      const hostname = view.hostname;
      const item = await Application.instance.storage.findOne<IFormFillData>({
        scope: 'formfill',
        query: {type: 'password', url: hostname},
      });
      if (!item) {
        const item = await Application.instance.storage.insert<IFormFillData>({
          scope: 'formfill',
          item: {
            type: 'password',
            url: hostname,
            favicon: appWindow.viewManager.selected.favicon,
            fields: {
              password,
              username,
              passLength: password.length,
            },
          },
        });

        appWindow.viewManager.settingsView.webContents.send(
          'credentials-insert',
          item,
        );
      } else {
        await Application.instance.storage.update({
          scope: 'formfill',
          query: {
            type: 'password',
            url: hostname,
            'fields.username': oldUsername,
            'fields.passLength': password.length,
          },
          value: {
            'fields.username': username,
            'fields.password': password,
          },
        });

        appWindow.viewManager.settingsView && appWindow.viewManager.settingsView.webContents.send(
          'credentials-update',
          {...data, hostname},
        );
      }

      //await setPassword('wexond', `${hostname}-${username}`, password);

      //appWindow.send(`has-credentials-${view.id}`, true);
    };

    ipcMain.on(`credentials-show-${id}`, (e, data) => {
      console.log("credentials-show", data);
      const {username, password, content, oldUsername} = data;
      if (content == "update" || content == "save") {
        saveCredentials({...data, update: content == "update"});
      }
      // appWindow.dialogs.credentialsDialog.send('credentials-update', data);
      // appWindow.dialogs.credentialsDialog.rearrange();
      // appWindow.dialogs.credentialsDialog.show();
    });

    // ipcMain.on(`credentials-hide-${id}`, () => {
    //   appWindow.dialogs.credentialsDialog.hide();
    // });

    ipcMain.on(`credentials-save-${id}`, async (e, data) => {
      saveCredentials(data);
    });

    ipcMain.on(`credentials-remove-${id}`, async (e, data: IFormFillData) => {
      const {_id, fields} = data;
      const view = appWindow.viewManager.selected;

      await Application.instance.storage.remove({
        scope: 'formfill',
        query: {
          _id,
        },
      });

      //await deletePassword('wexond', `${view.hostname}-${fields.username}`);

      appWindow.viewManager.settingsView.webContents.send(
        'credentials-remove',
        _id,
      );
    });

    // 页内下拉删除某条密码(按 _id),删除后通知设置页同步移除
    ipcMain.on(`credentials-delete-${id}`, async (e, recordId: string) => {
      if (!recordId) return;
      await Application.instance.storage.remove({
        scope: 'formfill',
        query: {_id: recordId},
      });
      const sv = appWindow.viewManager.settingsView;
      if (sv && !sv.webContents.isDestroyed()) {
        sv.webContents.send('credentials-remove', recordId);
      }
    });

    // 页内下拉「去管理」:打开 设置-密码填充
    ipcMain.on(`open-password-settings-${id}`, () => {
      appWindow.viewManager.create({
        url: `${getWebUIURL('settings')}?section=autofill`,
        active: true,
      });
    });

    // 该 handler 是全局的(无 -id 后缀),但 runMessagingService 每窗口都会跑。
    // 撕离/多窗口时重复注册会抛 "second handler",先移除旧的保证幂等。
    ipcMain.removeHandler('credentials-get-password');
    ipcMain.handle(
      'credentials-get-password',
      async (e, id: string) => {
        console.log(id);
        const item = await Application.instance.storage.findOne<IFormFillData>({
          scope: 'formfill',
          query: {
            _id: id,
          }
        });
        return item?.fields?.password || '';
      },
    );
  }

  // ── 书签栏「更多按钮」多列溢出菜单(独立 BrowserView 浮层) ──
  // 一级走多列浮层(支持多列 + 滚动箭头);子文件夹沿用最初的「原生单列菜单」
  // (createDropdown + popup),交互与书签栏文件夹下拉一致。详见 dialogs/bookmark-overflow.ts。
  let overflowAllBookmarks: IBookmark[] = [];
  const getOverflow = () =>
    Application.instance.dialogs.getPersistent('bookmark-overflow') as
      | BookmarkOverflowDialog
      | undefined;

  // 当前展开的原生子文件夹菜单,用于 hover 保持 / click toggle。
  // 原生 Menu 的开关状态浮层感知不到,由主进程统一跟踪;开/关浮层时清空。
  let folderMenu: {menu: Electron.Menu; folderId: string} | null = null;
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
    folderMenu = {menu, folderId};
    menu.popup({window: appWindow.win, x: Math.floor(x), y: Math.floor(y)});
  };

  ipcMain.handle(
    `show-bookmarks-bar-overflow-${id}`,
    (
      event,
      items: IBookmark[],
      allBookmarks: IBookmark[],
      {x, y}: {x: number; y: number},
    ) => {
      overflowAllBookmarks = allBookmarks || [];
      closeFolderMenu(); // 开浮层时清掉上一会话残留的子菜单状态
      getOverflow()?.open(appWindow.win, Math.floor(x), Math.floor(y), items);
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
    getOverflow()?.hide();
  });

  ipcMain.handle(
    `show-bookmarks-bar-dropdown-${id}`,
    async (
      event,
      folderId: string,
      bookmarks: IBookmark[],
      {
        x,
        y,
        df,
        dp,
      }: { x: number; y: number; df?: string; dp?: string },
    ) => {
      const menu = await bookmarkMenu.createDropdown(appWindow, folderId, bookmarks, {
        df,
        dp,
      });
      menu.popup({x: Math.floor(x), y: Math.floor(y), window: appWindow.win});
    },
  );
  ipcMain.handle(
    `show-bookmarks-bar-context-menu-${id}`,
    (event, item: IBookmark) => {
      bookmarkMenu.createMenu(appWindow, item).popup({window: appWindow.win});
    },
  );
};
