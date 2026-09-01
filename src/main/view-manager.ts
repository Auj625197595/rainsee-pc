import {
  BrowserView,
  BrowserWindow,
  WebContentsView,
  webContents as electronWebContents,
} from 'electron';
import type {
  HandlerDetails,
  LoadURLOptions,
  WebContents,
  WebFrameMain,
} from 'electron';
import {pathToFileURL} from 'url';
import {VIEW_Y_OFFSET} from '~/constants/design';
import {View} from './view';
import {AppWindow} from './windows';
import {
  WEBUI_BASE_URL,
  KOODO_READER_EXTS,
  buildKoodoReaderUrl,
  getHeaderDropFileType,
} from '~/constants/files';
import {parseBookmarklet} from '~/utils/url';

import {
  ZOOM_FACTOR_MIN,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_INCREMENT,
} from '~/constants/web-contents';
import {EventEmitter} from 'events';
import {Application} from './application';
// 开源版：AI 面板 / 订阅面板 / 账号云模块已移除。
import {getWebUIURL} from '~/common/webui-main';
import {getViewSecurityKind, isPdfUrl} from './view-web-preferences';
import {getNavigationContext} from './utils/navigation-context';
import {SIDEBAR_RESIZER_WIDTH} from './sidebar/sidebar-resizer';
import {SIDE_PANEL_HEADER_HEIGHT} from './side-panel/side-panel-view';
import {SECONDARY_SEARCH_HEADER_HEIGHT} from './secondary-search/secondary-search-panel';
import {showMediaPlayer} from './windows/media-player';
import {enterLocalImageViewer} from './services/image-viewer';
import {TrackedIpcMain} from './services/tracked-ipc';

// AI 侧栏拖拽条宽度常量的本地替代(原值来自 ai-panel 模块)
const RESIZER_WIDTH = 6;

const TINYPNG_URL = 'https://tinify.cn/';
const BAIDU_IMAGE_SEARCH_URL =
  'https://graph.baidu.com/pcpage/index?tpl_from=pc';

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const attributesToRecord = (attributes: string[]) => {
  const record: Record<string, string> = {};
  for (let index = 0; index < attributes.length; index += 2) {
    record[attributes[index]] = attributes[index + 1] || '';
  }
  return record;
};

type PageUploadFileType = 'pdf' | 'image';

// 目标站点使用隐藏 input[type=file] 接收本地文件。通过 CDP 设置真实文件路径，
// Chromium 会生成 FileList 并触发 input/change，后续上传仍完全走页面自己的流程。
const uploadFileToPage = async (
  webContents: Electron.WebContents,
  filePath: string,
  targetUrl: string,
  fileType: PageUploadFileType,
) => {
  const pageDebugger = webContents.debugger;
  const attachedByUs = !pageDebugger.isAttached();

  try {
    if (attachedByUs) pageDebugger.attach('1.3');
    await pageDebugger.sendCommand('DOM.enable');

    // React 页面在 did-finish-load 后仍会异步挂载路由组件，最多等待 12 秒。
    for (let attempt = 0; attempt < 48; attempt++) {
      if (webContents.isDestroyed()) return false;
      const currentUrl = webContents.getURL();
      if (!currentUrl.startsWith(targetUrl)) return false;

      try {
        const documentResult = await pageDebugger.sendCommand('DOM.getDocument', {
          depth: 0,
          pierce: true,
        });
        const rootNodeId = documentResult?.root?.nodeId;
        if (!rootNodeId) {
          await delay(250);
          continue;
        }

        const queryResult = await pageDebugger.sendCommand('DOM.querySelectorAll', {
          nodeId: rootNodeId,
          selector: 'input[type="file"]',
        });
        const nodeIds: number[] = queryResult?.nodeIds || [];
        const candidates: {nodeId: number; score: number}[] = [];

        for (const nodeId of nodeIds) {
          const result = await pageDebugger.sendCommand('DOM.getAttributes', {nodeId});
          const attributes = attributesToRecord(result?.attributes || []);
          const accept = (attributes.accept || '').toLowerCase();
          let score = 0;
          if (
            fileType === 'pdf' &&
            (accept.includes('application/pdf') || accept.includes('.pdf'))
          ) {
            score += 100;
          }
          if (fileType === 'image') {
            const extension = filePath
              .slice(filePath.lastIndexOf('.'))
              .toLowerCase();
            if (accept.includes('image/')) score += 100;
            if (extension && accept.includes(extension)) score += 100;
            if ((attributes['aria-labelledby'] || '').includes('upload')) {
              score += 50;
            }
            if ((attributes.class || '').includes('general-upload-file')) {
              score += 100;
            }
            if (attributes.name === 'file') score += 25;
          }
          if (attributes['data-testid'] === 'file-input') score += 50;
          if (Object.prototype.hasOwnProperty.call(attributes, 'multiple')) {
            score += 10;
          }
          candidates.push({nodeId, score});
        }

        candidates.sort((left, right) => right.score - left.score);
        for (const candidate of candidates) {
          try {
            await pageDebugger.sendCommand('DOM.setFileInputFiles', {
              files: [filePath],
              nodeId: candidate.nodeId,
            });
            console.log(
              `[${fileType}-upload] uploaded file to page input:`,
              filePath,
            );
            return true;
          } catch (error) {
            // React 可能刚好替换了节点，继续尝试下一个或下一轮 DOM。
          }
        }
      } catch (error) {
        console.warn(`[${fileType}-upload] waiting for upload input:`, error);
      }

      await delay(250);
    }

    console.warn(`[${fileType}-upload] file input not found within timeout`);
    return false;
  } finally {
    if (attachedByUs && pageDebugger.isAttached()) pageDebugger.detach();
  }
};

const uploadFileAfterPageLoaded = (
  webContents: Electron.WebContents,
  filePath: string,
  targetUrl: string,
  fileType: PageUploadFileType,
) => {
  let handled = false;
  const timeout = setTimeout(() => {
    webContents.removeListener('did-finish-load', onDidFinishLoad);
  }, 30000);

  const onDidFinishLoad = () => {
    if (handled || !webContents.getURL().startsWith(targetUrl)) return;
    handled = true;
    clearTimeout(timeout);
    webContents.removeListener('did-finish-load', onDidFinishLoad);
    uploadFileToPage(webContents, filePath, targetUrl, fileType).catch(
      (error) => {
        console.error(`[${fileType}-upload] automatic upload failed:`, error);
      },
    );
  };

  webContents.on('did-finish-load', onDidFinishLoad);
};

export class ViewManager extends EventEmitter {
  public views = new Map<number, View>();
  public selectedId = 0;
  public _fullscreen = false;

  // 幽灵 view 对账宽限期:新建 view 的 create-tab IPC 在途时 renderer 列表
  // 还没带上它,须等过窗后才允许按「不在列表」销毁(reconcileWithRendererOrder)。
  static readonly GHOST_VIEW_GRACE_MS = 10000;

  public incognito: boolean;

  private window: AppWindow;

  // 预热 View 池:始终保持一个已完成初始化、停在 about:blank 的隐藏 BrowserView,
  // 供新建标签/懒加载恢复时即时复用(acquireView),省去 new View() 的固定开销
  // (BrowserView 创建 + preload + 监听器注册)。取走后异步补充,池大小始终为 1。
  // 预热 View 不在 views map、不附加到窗口、不注册扩展——三者都在 acquire 后发生。
  private warmView: View | null = null;
  private warmingUp = false;
  private warmIncognito: boolean;

  private ipc = new TrackedIpcMain();

  // 冷启动外部文件在主窗口 renderer 加载前就开始导航。渲染层首次
  // views-create 会领养这个 View,不会重复创建同一个标签。
  private precreatedInitialViewId: number | null = null;
  private precreatedInitialUrl = '';

  // 最近一次测量得到的内容区矩形(标签内容 view 的正确 bounds)。select() 用它
  // 在 addBrowserView 前同步预定位新视图:新视图(如延迟标签首次加载)从未
  // setBounds,挂载后会以默认矩形短暂显示,直到 fixBounds 异步测量完成才纠正,
  // 视觉上即「内容从左侧滑入」。预定位消除这一帧错位。
  private lastContentBounds: { x: number; y: number; width: number; height: number } | null = null;

  // 每个标签最近一次被激活(选中)的时间戳。tab-throttle 服务据此判定「后台闲置
  // 超时」的标签,对其加强后台节流(item 2 内存节省)。切换/新建即更新。
  public lastActiveAt = new Map<number, number>();

  // renderer 最近一次上报的标签 id 全量列表(crx-set-tab-order)。渲染层 tabs
  // store 是标签数的唯一权威;主进程 views map 可能短暂残留幽灵 view,关闭/退出
  // 类 UI 的标签计数应优先读这里,null 表示 renderer 尚未上报(退化用 views.size)。
  private rendererTabIds: number[] | null = null;

  public get fullscreen() {
    return this._fullscreen;
  }

  /**
   * 用户可见的标签数(renderer tabs store 的全量列表,含 discarded 占位标签)。
   * 供退出确认等 UI 使用:主进程 views map 在个别路径下残留幽灵 view 会让
   * views.size 虚高(实测「只开 1 个标签却提示有 2 个」即此因)。renderer
   * 尚未上报时退化为 views.size。
   */
  public get rendererTabCount(): number {
    return this.rendererTabIds ? this.rendererTabIds.length : this.views.size;
  }

  public getById(id: number) {
    return this.views.get(id);
  }

  private isBlankNewTabUrl(url?: string) {
    return typeof url === 'string' && url.startsWith(getWebUIURL('newtab'));
  }

  private getTypeAheadText(input: any) {
    const key = typeof input?.key === 'string' ? input.key : '';
    if (!key) return null;
    if (key === 'Space' || key === 'Spacebar') return ' ';
    if (key.length === 1) return key;
    return null;
  }

  private ownsIpcSender(sender: WebContents) {
    if (sender === this.window.webContents) return true;
    if (this.findViewByWebContentsId(sender.id)) return true;

    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (senderWindow === this.window.win) return true;

    const dialogs = Application.instance.dialogs;
    return (
      dialogs.dialogs.some(
        (dialog) =>
          dialog.browserWindow === this.window.win &&
          dialog.browserView.webContents === sender,
      ) ||
      dialogs.persistentDialogs.some(
        (dialog) =>
          dialog.browserWindow === this.window.win &&
          dialog.webContents === sender,
      )
    );
  }

  // 空白新标签页若被页面/BrowserView 抢走焦点,把用户第一下输入转发回地址栏。
  // 只兜底首键:一旦地址栏拿到焦点,后续输入走正常 input 事件链。
  private armNewTabTypeAhead(view: View) {
    const wc = view.webContents;
    if (!wc || wc.isDestroyed()) return;

    let active = true;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (!active) return;
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        wc.removeListener('before-input-event', onBeforeInput);
      } catch {
        // webContents may already be gone during teardown.
      }
    };

    const forwardToAddressBar = (text: string) => {
      this.window.send('addressbar-update-input', {
        id: view.id,
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
        focus: true,
        showSuggestions: true,
      });
      cleanup();
    };

    const onBeforeInput = (event: any, input: any) => {
      if (!active) return;
      if (this.selectedId !== view.id) {
        cleanup();
        return;
      }
      if (input?.type !== 'keyDown' || input?.isAutoRepeat) return;
      if (input?.control || input?.meta || input?.alt) return;

      if (input?.key === 'Backspace') {
        event.preventDefault();
        forwardToAddressBar('');
        return;
      }

      const text = this.getTypeAheadText(input);
      if (!text) return;

      event.preventDefault();
      forwardToAddressBar(text);
    };

    wc.on('before-input-event', onBeforeInput);
    wc.once('destroyed', cleanup);
    wc.once('did-finish-load', () => setTimeout(cleanup, 400));
    wc.once('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      const navigation = getNavigationContext(event, url, isInPlace, isMainFrame);
      if (navigation.isMainFrame && !this.isBlankNewTabUrl(navigation.url)) {
        cleanup();
      }
    });

    timer = setTimeout(cleanup, 5000);
    timer.unref?.();
  }

  private notifyRendererWhenLoaded(view: View) {
    view.webContents.once('did-finish-load', () => {
      if (!view.webContents.isDestroyed()) {
        this.window.send(`view-loaded-${this.window.id}`, view.id);
      }
    });
  }

  public precreateInitialView(url: string) {
    if (!url || this.precreatedInitialViewId !== null) {
      return this.precreatedInitialViewId;
    }
    const view = this.create(
      {url, active: true} as any,
      false,
      false,
      undefined,
      false,
    );
    this.precreatedInitialViewId = view.id;
    this.precreatedInitialUrl = url;
    this.notifyRendererWhenLoaded(view);
    return view.id;
  }

  public set fullscreen(val: boolean) {
    this._fullscreen = val;
    this.fixBounds();
  }

  public constructor(window: AppWindow, incognito: boolean) {
    super();

    this.window = window;
    this.incognito = incognito;
    this.warmIncognito = incognito;
    window.win.once('closed', () => this.ipc.dispose());

    // ===== [RSZ] 最小化/还原 resize 排查(临时,定位后随 [RSZ] 一并移除) ========
    // 页面世界(view-preload 探针)抓到的真实 resize/visibilitychange 从这里回传,
    // 与下方 fixBounds / View.setBounds 的 [RSZ] 日志对照,即可区分页面收到的
    // resize 是我们布局链 setBounds 发出的,还是 Chromium 自身直发的。
    this.ipc.on('rsz-page-resize', (e, payload: any) => {
      if (e.sender.isDestroyed()) return;
      let tabId = -1;
      for (const [id, view] of this.views) {
        if (!view.webContents.isDestroyed() && view.webContents.id === e.sender.id) {
          tabId = id;
          break;
        }
      }
      // senderFrame.url 是权威帧来源(preload 的 frame 字段是自报,二者对照)。
      let frameUrl = '?';
      try {
        frameUrl = (e.senderFrame?.url || '').slice(0, 100);
      } catch {}
      console.log(
        `[RSZ] page#${tabId} src=${frameUrl} ${JSON.stringify(payload ?? {})}`,
      );
    });

    const {id} = window.win;
    this.ipc.handle(`view-create-${id}`, (e, details) => {
      console.log('[PDF Drag-Drop] Main process view-create, details.url:', details.url);
      const view = this.create(details, false, false);
      if (this.isBlankNewTabUrl(details?.url)) {
        this.armNewTabTypeAhead(view);
      }
      this.notifyRendererWhenLoaded(view);
      return view.id;
    });

    // 空白新标签页加载完成后夺回地址栏焦点用:页面 autofocus 已把键盘焦点交给
    // BrowserView webContents,需先释放它再把物理焦点交还主窗口,否则地址栏 input
    // 只 DOM focus(光标在)而键盘输入落空。
    this.ipc.handle(`focus-main-window-${id}`, () => {
      if (this.window.win.isDestroyed()) return;
      // Electron webContents 无 blur():焦点互斥,聚焦主窗口 webContents 即令
      // BrowserView webContents 失焦,从而把物理键盘焦点交还地址栏所在的主窗口。
      this.window.webContents.focus();
    });

    this.ipc.handle(`views-create-${id}`, (e, options) => {
      return options.map((option: any) => {
        const precreated =
          this.precreatedInitialViewId !== null
            ? this.views.get(this.precreatedInitialViewId)
            : undefined;
        if (precreated && option?.url === this.precreatedInitialUrl) {
          this.precreatedInitialViewId = null;
          this.precreatedInitialUrl = '';
          // The page may have completed before the renderer registered its
          // startup listener. Send a deferred acknowledgement in that case.
          if (!precreated.webContents.isLoading()) {
            setTimeout(() => {
              if (!precreated.webContents.isDestroyed()) {
                this.window.send(`view-loaded-${this.window.id}`, precreated.id);
              }
            }, 0);
          }
          return precreated.id;
        }
        const view = this.create(option, false, false);
        this.notifyRendererWhenLoaded(view);
        return view.id;
      });
    });

    this.ipc.on(`add-tab-${id}`, (e, details) => {
      if (!this.ownsIpcSender(e.sender)) return;
      // bookmarklet(javascript: 脚本):不开新标签,改为在当前网页执行。
      // 渲染端书签栏/溢出浮层都经此咽喉,故在此统一识别。
      const bookmarklet = parseBookmarklet(details?.url);
      if (bookmarklet !== null) {
        console.log('[bookmarklet] add-tab 拦截,原 URL:', details.url);
        this.runBookmarklet(bookmarklet);
        return;
      }
      this.create(details);
    });

    this.ipc.on('open-dev-tool', (e, details) => {
      if (!this.ownsIpcSender(e.sender)) return;
      //this.views.get(this.selectedId).webContents.print();
      const selected = this.selected;
      if (!selected) return;
      selected.webContents.inspectElement(0, 0);
      if (selected.webContents.isDevToolsOpened()) {
        selected.webContents.devToolsWebContents.focus();
      }
    });

    this.ipc.handle(`view-select-${id}`, (e, id: number, focus: boolean) => {
      // if (process.env.ENABLE_EXTENSIONS) {
      //   extensions.tabs.activate(id, focus);
      // } else {
      //   this.select(id, focus);
      // }
      this.select(id, focus, true);
    });

    this.ipc.on(`view-destroy-${id}`, (e, id: number) => {
      this.destroy(id);
    });

    this.ipc.on(`mute-view-${id}`, (e, tabId: number) => {
      // 延迟标签无 webContents(也无音频),静默忽略。
      const view = this.views.get(tabId);
      if (view) view.webContents.setAudioMuted(true);
    });

    this.ipc.on(`unmute-view-${id}`, (e, tabId: number) => {
      const view = this.views.get(tabId);
      if (view) view.webContents.setAudioMuted(false);
    });

    this.ipc.on(`browserview-clear-${id}`, () => {
      this.clear();
    });

    this.ipc.on('change-zoom', (e, zoomDirection, showDialog = true) => {
      if (!this.ownsIpcSender(e.sender)) return;
      this.changeZoom(zoomDirection, e, showDialog);
    });

    this.ipc.on('reset-zoom', (e) => {
      if (!this.ownsIpcSender(e.sender)) return;
      this.resetZoom();
    });

    // 双引擎搜索:搜索触发 → 在当前标签右侧加载副引擎(移动端 UA)。
    // 仅在总开关开启时生效;副引擎按下标取,index 非法则按 keyword 兜底(秘塔)。
    // 同时把主引擎 URL 模板 + 被搜索视图 id 交给面板,供「导航离开搜索页才收起」判定。
    this.ipc.on(`dual-engine-search-${id}`, (_e, data: string | {
      query?: string;
      viewId?: number;
    }) => {
      const settings = Application.instance.settings.object;
      if (settings.efficiencySearchMode !== 'dual') return;
      const query = typeof data === 'string' ? data : data?.query;
      if (typeof query !== 'string' || !query.trim()) return;
      const requestedViewId = typeof data === 'string' ? undefined : data?.viewId;
      const tabId =
        typeof requestedViewId === 'number' && this.views.has(requestedViewId)
          ? requestedViewId
          : this.selectedId;
      if (!tabId) return;
      const engines = settings.searchEngines;
      let engine = engines?.[settings.secondarySearchEngine];
      if (!engine || !engine.url) {
        engine = engines?.find((x) => x.keyword === 'metaso.cn');
      }
      if (!engine || !engine.url) return;
      const url = (engine.url as string).replace('%s', encodeURIComponent(query.trim()));
      const primaryEngine = engines?.[settings.searchEngine];
      this.window.secondarySearchPanels?.show({
        url,
        engineName: engine.name || '副引擎',
        primaryEngineUrl: primaryEngine?.url || '',
        viewId: tabId,
      });
    });

    // 双引擎侧边栏告知条「关闭」按钮:用户主动放弃 → 销毁(切回不再恢复)
    this.ipc.on(`dual-engine-hide-${id}`, () => {
      this.window.secondarySearchPanels?.dismissCurrent();
    });

    // 双引擎侧边栏告知条「设置」按钮 → 打开设置 地址栏 区并高亮开关
    this.ipc.on(`dual-engine-open-settings-${id}`, () => {
      this.create(
        {
          url: `${getWebUIURL('settings')}?section=address-bar&highlight=efficiencySearch`,
          active: true,
        } as any,
        true,
      );
    });

    // 处理来自渲染器的拖拽文件打开请求
    this.ipc.on(`drag-drop-file-${id}`, (_e, filePaths: string[]) => {
      console.log('[drag-drop-file] received:', filePaths);
      filePaths.forEach((filePath, i) => {
        const active = i === filePaths.length - 1;
        const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();

        if (KOODO_READER_EXTS.includes(ext)) {
          // koodoreader 支持的电子书格式 → 阅读器直开
          const url = buildKoodoReaderUrl(filePath);
          console.log(`[drag-drop-file] opening in koodoreader: ${url}`);
          if (url) this.create({ url, active });
        } else if (ext === 'html' || ext === 'htm') {
          const url = `file:///${filePath.replace(/\\/g, '/')}`;
          console.log(`[drag-drop-file] opening HTML: ${url}`);
          this.create({ url, active });
        }
      });
    });

    this.ipc.on(
      `header-file-action-${id}`,
      async (_e, payload: {action?: string; filePath?: string}) => {
        const action = payload?.action || '';
        const filePath = payload?.filePath || '';
        const fileType = getHeaderDropFileType(filePath);
        if (!fileType) return;

        const allowedActions: Record<string, string[]> = {
          pdf: ['pdf-read'],
          image: [
            'image-view',
            'image-compress',
            'image-search',
          ],
          video: ['video-play'],
          reader: ['reader-read'],
          html: ['html-open'],
        };
        if (!allowedActions[fileType]?.includes(action)) return;

        if (action === 'pdf-read' || action === 'reader-read') {
          const url = buildKoodoReaderUrl(filePath);
          if (url) this.create({url, active: true});
          return;
        }

        if (action === 'image-view') {
          try {
            await enterLocalImageViewer(filePath, this.window);
          } catch (error) {
            console.error('[header-file-action] local image viewer failed:', error);
          }
          return;
        }

        if (action === 'html-open') {
          this.create({url: pathToFileURL(filePath).toString(), active: true});
          return;
        }

        if (action === 'image-compress') {
          const compressView = this.create({url: TINYPNG_URL, active: true});
          uploadFileAfterPageLoaded(
            compressView.webContents,
            filePath,
            TINYPNG_URL,
            'image',
          );
          return;
        }

        if (action === 'image-search') {
          await this.handleImageFileAction(action, filePath);
          return;
        }

        if (action === 'video-play') {
          showMediaPlayer(this.window.win, filePath);
        }
      },
    );

    this.setBoundsListener();
  }

  // 顶部栏拖图与截图工具共用图片动作，保证搜图行为一致。
  public async handleImageFileAction(
    action: 'image-search',
    filePath: string,
  ): Promise<boolean> {
    if (action !== 'image-search') return false;

    const searchView = this.create({
      url: BAIDU_IMAGE_SEARCH_URL,
      active: true,
    });
    uploadFileAfterPageLoaded(
      searchView.webContents,
      filePath,
      BAIDU_IMAGE_SEARCH_URL,
      'image',
    );
    return true;
  }

  public resetZoom() {
    this.selected.webContents.zoomFactor = 1;
    this.selected.emitEvent(
      'zoom-updated',
      this.selected.webContents.zoomFactor,
    );
    this.emitZoomUpdate();
  }

  public changeZoom(zoomDirection: 'in' | 'out', e?: any, showDialog = true) {
    const newZoomFactor =
      this.selected.webContents.zoomFactor +
      (zoomDirection === 'in'
        ? ZOOM_FACTOR_INCREMENT
        : -ZOOM_FACTOR_INCREMENT);

    if (
      newZoomFactor <= ZOOM_FACTOR_MAX &&
      newZoomFactor >= ZOOM_FACTOR_MIN
    ) {
      this.selected.webContents.zoomFactor = newZoomFactor;
      this.selected.emitEvent(
        'zoom-updated',
        this.selected.webContents.zoomFactor,
      );
    } else {
      e?.preventDefault();
    }
    this.emitZoomUpdate(showDialog);
  }

  public get selected() {
    return this.views.get(this.selectedId);
  }

  /** 最近一次测得的内容区矩形,供 View.showAfterLoading 挂回加载隐藏中的视图时定位。 */
  public get contentBounds() {
    return this.lastContentBounds;
  }

  // 预热一个隐藏 View(若池空):首屏稳定后由 AppWindow 触发,acquireView 取走后
  // 也会调本方法异步补充。setImmediate 推迟创建,避免与当前点击/加载事件抢占主线程
  // ——new View() 是 CPU 密集(创建 BrowserView + 注册大量监听),放在事件循环空闲时做。
  public ensureWarmView() {
    if (this.warmView || this.warmingUp) return;
    if (this.window.win.isDestroyed()) return;
    this.warmingUp = true;
    setImmediate(() => {
      this.warmingUp = false;
      if (this.warmView || this.window.win.isDestroyed()) return;
      try {
        const t0 = Date.now();
        this.warmView = new View(this.window, '', this.warmIncognito, {
          warm: true,
        });
        const dt = Date.now() - t0;
        console.log(
          `[warm] PRELOAD  created hidden view id=${this.warmView.id} in ${dt}ms (pool size=1, incognito=${this.warmIncognito})`,
        );
      } catch (e) {
        console.log('[warm] failed to create warm view:', e && e.message);
        this.warmView = null;
      }
    });
  }

  // 从预热池领取一个尚未导航的 View;池空或 incognito 不匹配时 fallback 到
  // 同步 new View()。create() 完成元数据写入与 views 注册后再调用 load(),
  // 让目标页 preload 能同步反查到当前 view。领走后立即异步补充一个。
  private acquireView(
    url: string,
    incognito: boolean,
    loadOptions?: LoadURLOptions,
    pdfCompat = false,
  ): View {
    const warm = this.warmView;
    const targetKind = getViewSecurityKind(url);
    if (
      targetKind === 'sandboxed' &&
      !pdfCompat &&
      warm &&
      !warm.webContents.isDestroyed() &&
      incognito === this.warmIncognito
    ) {
      this.warmView = null;
      console.log(`[warm] HIT   reusing preloaded id=${warm.id} → ${url}`);
      // 异步补充:用 setImmediate 错开,不阻塞当前 acquire/加载。
      setImmediate(() => this.ensureWarmView());
      return warm;
    }
    const reason = targetKind !== 'sandboxed'
      ? `security kind ${targetKind}`
      : pdfCompat
      ? 'PDF compatibility view'
      : !warm
      ? 'pool empty'
      : warm.webContents.isDestroyed()
        ? 'warm view destroyed'
        : `incognito mismatch (pool=${this.warmIncognito} want=${incognito})`;
    console.log(`[warm] MISS  new View → ${url}  (${reason})`);
    return new View(this.window, url, incognito, {
      ...(loadOptions ? {loadOptions} : {}),
      ...(pdfCompat ? {pdfCompat: true} : {}),
      deferLoad: true,
    });
  }

  // 在当前选中标签的网页上执行 bookmarklet 脚本体(src 已解码)。
  // 仅 http(s)/file 普通网页执行,跳过内部页(chrome://、webui 等)——既避免
  // 在书签管理器这类内部页上误跑脚本,也贴近 Chrome 只允许在网页跑 bookmarklet 的行为。
  // userGesture=true:bookmarklet 常用 prompt()/window.open(),需用户激活才不被拦截。
  public runBookmarklet(src: string) {
    const view = this.selected;
    if (!view || view.webContents.isDestroyed()) return;

    const url = view.webContents.getURL();
    if (!/^(https?|file):/i.test(url)) {
      console.warn('[bookmarklet] 当前标签不是网页,跳过执行:', url);
      return;
    }

    try {
      view.webContents
        .executeJavaScript(src, true)
        .catch((err: unknown) =>
          console.error('[bookmarklet] executeJavaScript 失败:', err),
        );
    } catch (err) {
      console.error('[bookmarklet] 注入异常:', err);
    }
  }

  public get settingsView() {
    return Object.values(this.views).find((r) =>
      r.url.startsWith(`${WEBUI_BASE_URL}settings`),
    );
  }

  public findByKey(key: string): View {
    return Object.values(this.views).find((r) =>
      r.url.includes(`${key}`),
    );
  }

  public create(
    details: chrome.tabs.CreateProperties,
    isNext = false,
    sendMessage = true,
    openerTabId?: number,
    _notifyCloud = true,
  ) {
    // Chrome 的无痕边界是窗口，而不是单个标签。忽略来自 renderer/扩展的
    // incognito 标记，避免普通窗口混入共享 viewIncognito session 的标签。
    const incognito = this.incognito;
    // 透传 POST 表单 target=_blank 等场景的 loadURL options(postData + Content-Type)。
    const internalDetails = details as any;
    const loadOptions = internalDetails.loadOptions as LoadURLOptions | undefined;
    const pdfCompat = isPdfUrl(details.url || '');
    const view = this.acquireView(details.url, incognito, loadOptions, pdfCompat);

    // Make sure the renderer-side tab carries the same flag for styling and
    // history/startup-tab guards.
    (details as any).incognito = incognito;

    const {webContents} = view.browserView;
    const {id} = view;

    this.views.set(id, view);
    // 记录创建时间作为「最近活跃」基线:后台打开(从不被选中)的标签也据此计闲置,
    // 否则 tab-throttle 巡检因无时间戳而永远跳过它们(而这类标签正是最该释放缓存的)。
    // 前台标签会在 select() 里刷新为选中时刻。
    this.lastActiveAt.set(id, Date.now());

    view.load(details.url, loadOptions);

    if (process.env.ENABLE_EXTENSIONS) {
      //extensions.tabs.observe(webContents);
    }

    webContents.once('destroyed', () => {
      this.views.delete(id);
    });

    if (sendMessage) {
      // loadOptions 含 Buffer postData,renderer 显示 tab UI 用不到,剥离避免无谓跨 IPC 序列化。
      const {
        loadOptions: _stripped,
        ...tabDetails
      } = details as any;
      this.window.send('create-tab', {...tabDetails}, isNext, id, openerTabId);
    }

    return view;
  }

  /** 按 Chromium opener frame 查找当前窗口内由它创建的最新 popup 标签。 */
  public findViewByOpener(
    openerFrame: WebFrameMain,
    predicate: (view: View) => boolean = () => true,
  ): View | undefined {
    return Array.from(this.views.values())
      .filter((view) => {
        if (view.webContents.isDestroyed() || !predicate(view)) return false;
        return this.hasOpener(view.webContents, openerFrame);
      })
      .sort((left, right) => right.id - left.id)[0];
  }

  /** 同一标签的 window.open 覆盖页也需要路由到其宿主 View。 */
  public findViewByWebContentsId(webContentsId: number): View | undefined {
    // The common case is the primary WebContents whose id is also the map key.
    // Only scan all views for a transient window.open overlay.
    const direct = this.views.get(webContentsId);
    if (direct) return direct;
    for (const view of this.views.values()) {
      if (view.containsWebContents(webContentsId)) return view;
    }
    return undefined;
  }

  /** 查找 Chromium 为 window.open 预创建、尚未注册成标签的真实目标。 */
  public findWindowOpenTarget(openerFrame: WebFrameMain): WebContents | undefined {
    return electronWebContents
      .getAllWebContents()
      .filter(
        (candidate) =>
          !candidate.isDestroyed() &&
          candidate.getType() === 'window' &&
          !this.views.has(candidate.id) &&
          this.hasOpener(candidate, openerFrame),
      )
      .sort((left, right) => right.id - left.id)[0];
  }

  private hasOpener(candidate: WebContents, openerFrame: WebFrameMain) {
    const opener = candidate.opener;
    return (
      !!opener &&
      opener.processId === openerFrame.processId &&
      opener.routingId === openerFrame.routingId
    );
  }

  /**
   * 创建由 Electron window.open 流程接管首次导航的标签。
   *
   * 返回的 WebContents 会直接交给 setWindowOpenHandler.createWindow，Chromium
   * 因而能建立真实 opener/WindowProxy；这里不能再调用 loadURL，否则会与
   * Electron 随后的首次导航竞争，并破坏 about:blank 的同步 document.write。
   */
  public createWindowOpenTarget(
    details: HandlerDetails,
    childTarget: WebContents | BrowserView | WebContentsView,
    active: boolean,
    openerTabId: number,
  ) {
    const incognito = this.incognito;
    const url = details.url || 'about:blank';
    const startedBlank = /^about:blank(?:[?#]|$)/i.test(url);
    const view = new View(
      this.window,
      url,
      incognito,
      childTarget instanceof BrowserView
        ? {
            deferLoad: true,
            adoptedBrowserView: childTarget,
            ...(isPdfUrl(url) ? {pdfCompat: true} : {}),
          }
        : childTarget instanceof WebContentsView
          ? {
              deferLoad: true,
              adoptedContentView: childTarget,
              ...(isPdfUrl(url) ? {pdfCompat: true} : {}),
            }
          : {
              deferLoad: true,
              adoptedWebContents: childTarget,
              ...(isPdfUrl(url) ? {pdfCompat: true} : {}),
            },
    );

    const {webContents} = view;
    const {id} = view;
    this.views.set(id, view);
    this.lastActiveAt.set(id, Date.now());
    view.setWindowOpenStartedBlank(startedBlank);
    view.registerExtensionContext();

    webContents.once('destroyed', () => {
      this.views.delete(id);
    });

    this.window.send(
      'create-tab',
      {url, active, incognito},
      true,
      id,
      openerTabId,
    );
    // createWindow 回调返回前就把真实子 WebContents 挂到内容区。若只等待
    // renderer 的 requestAnimationFrame 选中，新标签 UI 已出现时仍可能短暂
    // 展示来源页或旧的空 BrowserView；这里同步选择，renderer 随后再对齐标签栏。
    if (active) this.select(id, true);
    return view;
  }

  public removeByTabId(id: number) {
    this.window.send('remove-tab', id);
  }

  // 把一个 view 从本窗口"摘下"但不销毁它的 webContents,用于撕离/合并迁移。
  // 返回被摘下的 View;若它是当前选中项,先把选中切到相邻 view。
  public detachView(id: number): View {
    const view = this.views.get(id);
    if (!view) return null;

    const wasSelected = this.selectedId === id;

    // 先选中相邻 view,避免迁出后本窗口出现空白内容区。
    if (wasSelected) {
      const ids = Array.from(this.views.keys());
      const idx = ids.indexOf(id);
      const neighborId =
        ids[idx + 1] !== undefined ? ids[idx + 1] : ids[idx - 1];
      if (neighborId !== undefined && neighborId !== id) {
        this.select(neighborId, false);
      } else {
        // 没有相邻 view:本窗口即将清空,直接移除 BrowserView。
        view.detachFromWindow();
        this.selectedId = 0;
      }
    }

    view.detachFromWindow();
    this.views.delete(id);
    this.emit('removed', id);
    return view;
  }

  // 领养一个来自其它窗口的 View:接管 window 引用、webContents.windowId,
  // 并把它纳入本窗口的 views。webContents 不重建,页面/历史/播放状态保留。
  public adoptView(view: View, select = true) {
    const previousWindow = view.window;
    view.window = this.window;
    (view.webContents as any).windowId = this.window.win.id;
    this.views.set(view.id, view);

    if (previousWindow !== this.window) {
      const sessions = Application.instance.sessions;
      const extensions = view.incognito
        ? sessions.chromeExtensionsIncognito
        : sessions.chromeExtensions;
      extensions?.moveTabToWindow(view.webContents, this.window.win);
    }

    // create() 里注册的 destroyed 监听器闭包指向原 manager,迁移后让本
    // manager 也能在该 view 销毁时清理自己的 map。
    view.webContents.once('destroyed', () => {
      this.views.delete(view.id);
    });

    if (select) {
      this.select(view.id, true);
    }
    return view;
  }

  public clear() {
    this.ipc.dispose();
    // 预热 View 不在 views map,这里显式销毁,避免关窗时残留渲染进程。
    if (this.warmView) {
      this.warmView.destroy();
      this.warmView = null;
    }
    this.window.win.setBrowserView(null);
    for (const view of Array.from(this.views.values())) {
      view.destroy();
    }
    this.views.clear();
    this.lastActiveAt.clear();
    this.selectedId = 0;
  }

  public select(id: number, focus = true, callExtension = false) {
    const {selected} = this;
    const view = this.views.get(id);

    if (!view) {
      return;
    }

    // 先关闭本窗口所有仍可见的持久弹窗。select() 会把内容 view 经 addBrowserView
    // 重新挂回 z 序顶端,盖住弹窗 BrowserView;弹窗的 blur 自动关闭在本环境偶发失效,
    // 会卡在「被网页遮挡、无法关闭」的状态。主动关闭既避免被遮挡,也对齐 Chrome
    // 「切标签即关闭浮层」。在内容 view 重新挂载之前执行,确保弹窗先于内容被移除。
    const keepOpen = Application.instance.dialogs.persistentDialogs.some(
      (dialog) =>
        dialog.name === 'sidebar-panel' &&
        dialog.visible &&
        dialog.browserWindow === this.window.win,
    )
      ? ['sidebar-panel']
      : [];
    Application.instance.dialogs.hideAllPersistent(this.window.win, keepOpen);

    this.selectedId = id;
    // 记录该标签的最近激活时间,供 tab-throttle 服务判定后台闲置(item 2 内存节省)。
    this.lastActiveAt.set(id, Date.now());

    if (selected) {
      // 切走前抓取快照缓存,供悬停预览卡展示(此刻 view 仍挂载,可正常抓取)。
      selected.captureThumbnail();
      selected.detachFromWindow();
    }

    // 新视图(延迟标签首次加载等)从未 setBounds,Electron 42 的 BrowserView
    // 在未设 bounds 时挂载会短暂以默认矩形显示,随后 fixBounds 才异步测量纠正
    // ——视觉上即「内容从左侧滑入」。挂载前用上次测得的内容区矩形同步预定位,
    // 让视图一挂载就在正确位置;fixBounds 随后只会复核/微调,不再产生位移。
    if (this.lastContentBounds) {
      view.setBounds(this.lastContentBounds);
    }

    // 暗色模式加载隐藏中:跳过挂载,等 did-finish-load 由 View.showAfterLoading 挂回,
    // 避免加载中的网页(FOUC 白底)露出来。bounds 仍按内容区预置,挂回时直接复用。
    if (!view.isLoadingHidden) {
      view.attachToWindow();
    }
    this.window.refreshImmersiveHeaderLayer();
    this.window.syncImmersivePageIndicator();

    // 侧栏拖拽条有一半命中区跨在网页边缘上；切换标签后新网页会成为最上层，
    // 因此先把拖拽条提回网页之上。下面的弹窗/侧栏浮层仍会继续按原逻辑置顶。
    this.window.sidebarResizer?.bringToTop();

    // 侧边栏缩放浮层若保持打开,这里要把它重新提回 z 序顶端。select() 会把新
    // 选中的内容 view addBrowserView 到最上层;若不再 bringToTop,浮层会被网页
    // 压在下面,视觉上像「点关闭后只剩网页区域」。
    if (keepOpen.includes('sidebar-panel')) {
      const sidebarPanel = Application.instance.dialogs.getExistingPersistent(
        'sidebar-panel',
      );
      if (sidebarPanel?.visible && sidebarPanel.browserWindow === this.window.win) {
        sidebarPanel.bringToTop();
      }
    }

    // 切标签时同步扩展 sidePanel 面板:显示新标签自己的面板或收起
    this.window.sidePanels?.onTabActivated(id);

    // 切标签时同步「双引擎搜索」面板:新标签有自己的搜索面板则显示,否则收起
    // (面板与搜索页绑定,跟随激活标签)。
    this.window.secondarySearchPanels?.onTabActivated(id);

    if (focus) {
      // Also fixes switching tabs with Ctrl + Tab
      view.webContents.focus();
    } else {
      this.window.webContents.focus();
    }

    this.window.updateTitle();
    view.updateBookmark();

    this.fixBounds();

    view.updateNavigationState();

    this.emit('activated', id);
    // 按 incognito 选扩展实例(与 addTab 守卫一致)。无痕 view 走第二实例
    // chromeExtensionsIncognito;无白名单时为 null,selectTab 跳过。selectTab 内部有
    // ctx.store.tabs.has(tab) 校验,未注册的 tab 自动跳过,安全。
    if (callExtension) {
      const crx = view.incognito
        ? Application.instance.sessions.chromeExtensionsIncognito
        : Application.instance.sessions.chromeExtensions;
      if (crx) {
        try {
          crx.selectTab(view.webContents);
        } catch (e) {
          console.log(`[view-manager] selectTab failed err=${e && e.message}`);
        }
      }
    }

    // TODO: this.emitZoomUpdate(false);
  }


  private timer: any = null;
  private boundsUpdateInFlight: Promise<void> | null = null;
  private boundsUpdatePending = false;
  private sidebarResizeActive = false;
  private liveSidebarWidth: number | null = null;

  public beginSidebarResize() {
    this.sidebarResizeActive = true;
    this.liveSidebarWidth =
      Number(Application.instance.settings.object.sidebarWidth) || 240;
  }

  // 拖拽热路径直接调整原生视图，不再等待 renderer 布局、ResizeObserver 和
  // executeJavaScript 的两次跨进程往返。renderer 只需同步一个 CSS 变量。
  public resizeSidebarLive(width: number) {
    if (!this.sidebarResizeActive || this.liveSidebarWidth == null) {
      this.beginSidebarResize();
    }

    const previousWidth = this.liveSidebarWidth as number;
    const delta = width - previousWidth;
    if (delta === 0) return;
    this.liveSidebarWidth = width;

    const layout = Application.instance.settings.object.tabsLayout;
    if (layout !== 'left' && layout !== 'right') return;

    const view = this.selected;
    if (view?.bounds) {
      const nextBounds = {
        ...view.bounds,
        x: layout === 'left' ? view.bounds.x + delta : view.bounds.x,
        width: Math.max(0, view.bounds.width - delta),
      };
      view.setBounds(nextBounds);
      this.lastContentBounds = nextBounds;
    }

    const sidebarResizer = this.window.sidebarResizer;
    if (sidebarResizer?.bounds) {
      sidebarResizer.setBounds({
        ...sidebarResizer.bounds,
        x:
          sidebarResizer.bounds.x +
          (layout === 'left' ? delta : -delta),
      });
    }

    // 右侧标签栏会推动位于内容区右缘的附加面板；左侧标签栏只改变主网页
    // 的左缘，附加面板贴着窗口右缘，无需移动。
    if (layout === 'right') this.shiftRightPanels(-delta);
  }

  public endSidebarResize() {
    this.sidebarResizeActive = false;
    this.liveSidebarWidth = null;
    void this.fixBounds();
  }

  private shiftRightPanels(deltaX: number) {
    const shift = (
      browserView: any,
      bounds: any,
      update: (bounds: any) => void,
    ) => {
      if (!browserView || !bounds) return;
      const nextBounds = {...bounds, x: bounds.x + deltaX};
      browserView.setBounds(nextBounds);
      update(nextBounds);
    };

    const sidePanel = this.window.sidePanels;
    const sidePanelView = sidePanel?.currentPanel;
    if (sidePanel?.isVisible && sidePanelView) {
      shift(sidePanelView.headerView, sidePanelView.headerBounds, (bounds) => {
        sidePanelView.headerBounds = bounds;
      });
      shift(sidePanelView.browserView, sidePanelView.bounds, (bounds) => {
        sidePanelView.bounds = bounds;
      });
      if (sidePanel.resizerView.bounds) {
        sidePanel.resizerView.setBounds({
          ...sidePanel.resizerView.bounds,
          x: sidePanel.resizerView.bounds.x + deltaX,
        });
      }
    }

    const secondary = this.window.secondarySearchPanels;
    const secondaryPanel = secondary?.currentPanel;
    if (secondary?.isVisible && secondaryPanel) {
      shift(secondaryPanel.headerView, secondaryPanel.headerBounds, (bounds) => {
        secondaryPanel.headerBounds = bounds;
      });
      shift(secondaryPanel.browserView, secondaryPanel.bounds, (bounds) => {
        secondaryPanel.bounds = bounds;
      });
      if (secondary.resizerView.bounds) {
        secondary.resizerView.setBounds({
          ...secondary.resizerView.bounds,
          x: secondary.resizerView.bounds.x + deltaX,
        });
      }
    }
  }

  public async fixBounds() {
    if (this.sidebarResizeActive) return;
    if (this.boundsUpdateInFlight) {
      this.boundsUpdatePending = true;
      return this.boundsUpdateInFlight;
    }

    const run = async () => {
      do {
        this.boundsUpdatePending = false;
        await this.fixBounds0(0);
      } while (this.boundsUpdatePending);
    };

    this.boundsUpdateInFlight = run().finally(() => {
      this.boundsUpdateInFlight = null;
    });
    return this.boundsUpdateInFlight;
  }
  public async fixBounds0(count: number) {
    const view = this.selected;

    if (!view) return;
    try {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    } catch (e) {
    }

    const {width, height} = this.window.win.getContentBounds();

    // Measure the content anchor element (#view-anchor). It marks the exact
    // rectangle the web content should occupy, so it works for the top tab bar
    // as well as the left/right sidebar layouts. Falls back to the legacy
    // "#app height = top offset" behaviour when the anchor is missing.
    const anchor = await this.window.win.webContents.executeJavaScript(`
      (() => {
        const el = document.getElementById('view-anchor');
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        }
        const app = document.getElementById('app');
        const h = app ? app.offsetHeight : 0;
        return { x: 0, y: h, width: ${width}, height: ${height} - h };
      })()
    `);

    // 拖拽可能在异步 DOM 测量期间开始，丢弃这份已经过期的结果。
    if (this.sidebarResizeActive) return;

    // [RSZ] 排查日志(临时):只记首测(count=0),启动期 anchor 未就绪的 25ms
    // 重试不刷屏;最终是否应用见函数末尾的 APPLY/SKIP 日志。
    if (count === 0) {
      console.log(
        `[RSZ] fixBounds measure content=${width}x${height}` +
          ` anchor=${anchor.x},${anchor.y},${anchor.width},${anchor.height}` +
          ` min=${this.window.win.isDestroyed() ? '?' : this.window.win.isMinimized()}`,
      );
    }

    const toolbarContentHeight = anchor.y;
    if (toolbarContentHeight <= 0 && count < 40) {
      this.timer = setTimeout(() => {
        this.fixBounds0(count + 1);
      }, 25);
    }

    const newBounds = {
      x: this.fullscreen ? 0 : anchor.x,
      y: this.fullscreen ? 0 : anchor.y,
      width: this.fullscreen ? width : anchor.width,
      height: this.fullscreen ? height : anchor.height,
    };

    // 标签页侧边栏模式:拖拽热区以「侧边栏—网页」边界为中心，两侧各覆盖一半，
    // 视觉竖线因此精确落在边界上。热区默认完全透明，仅 hover/拖拽时显示细线；
    // 它不参与 flex 布局，所以网页与侧边栏之间不会多出可见间隙。
    const tabsLayout = Application.instance.settings.object.tabsLayout;
    // 缩放模式(sidebarPinned=false)下侧边栏是固定 62px 窄轨、不可调宽,
    // 故完全隐藏拖拽条。默认(undefined)视为固定模式,保留拖拽条。
    const sidebarPinned =
      (Application.instance.settings.object as any).sidebarPinned !== false;
    const sidebarResizer = this.window.sidebarResizer;
    if (
      sidebarResizer &&
      sidebarPinned &&
      (tabsLayout === 'left' || tabsLayout === 'right') &&
      !this.fullscreen
    ) {
      sidebarResizer.attach();
      const halfResizerWidth = Math.floor(SIDEBAR_RESIZER_WIDTH / 2);
      if (tabsLayout === 'left') {
        sidebarResizer.setBounds({
          x: newBounds.x - halfResizerWidth,
          y: 0,
          width: SIDEBAR_RESIZER_WIDTH,
          height: height,
        });
      } else {
        sidebarResizer.setBounds({
          x: newBounds.x + newBounds.width - halfResizerWidth,
          y: 0,
          width: SIDEBAR_RESIZER_WIDTH,
          height: height,
        });
      }
    } else if (sidebarResizer) {
      sidebarResizer.detach();
    }

    // 扩展 sidePanel 面板可见时,同样从内容区右侧让出 panelWidth + 拖拽条。
    // 与下方双引擎搜索面板同侧互斥,运行时不会同时命中。
    const sp = this.window.sidePanels;
    if (sp && sp.isVisible && !this.fullscreen) {
      const panelW = Math.min(sp.width, Math.max(0, newBounds.width - 200));
      const totalRight = panelW + RESIZER_WIDTH;
      newBounds.width = Math.max(0, newBounds.width - totalRight);

      const panel = sp.currentPanel;
      if (panel && panel.browserView && panel.headerView) {
        const px = newBounds.x + newBounds.width + RESIZER_WIDTH;
        const hb = {
          x: px,
          y: newBounds.y,
          width: panelW,
          height: SIDE_PANEL_HEADER_HEIGHT,
        };
        panel.headerView.setBounds(hb);
        panel.headerBounds = hb;
        const pb = {
          x: px,
          y: newBounds.y + SIDE_PANEL_HEADER_HEIGHT,
          width: panelW,
          height: Math.max(0, newBounds.height - SIDE_PANEL_HEADER_HEIGHT),
        };
        panel.browserView.setBounds(pb);
        panel.bounds = pb;
        sp.resizerView.setBounds({
          x: newBounds.x + newBounds.width,
          y: newBounds.y,
          width: RESIZER_WIDTH,
          height: newBounds.height,
        });
      }
    }

    // 「双引擎搜索」面板可见时,从内容区右侧让出 panelW + 分割条(可拖拽调宽,宽度持久化)。
    // 与上面 sidePanel 同侧互斥,运行时不会同时命中。
    // 顶部 SECONDARY_SEARCH_HEADER_HEIGHT 给告知条,其下才是副引擎结果页;
    // 分割条贴在面板左缘(主网页与面板之间)。
    const ssp = this.window.secondarySearchPanels;
    if (ssp && ssp.isVisible && !this.fullscreen) {
      const panelW = Math.min(
        ssp.width,
        Math.max(0, newBounds.width - 200),
      );
      const totalRight = panelW + RESIZER_WIDTH;
      newBounds.width = Math.max(0, newBounds.width - totalRight);

      const panel = ssp.currentPanel;
      if (panel && panel.browserView && panel.headerView) {
        const px = newBounds.x + newBounds.width + RESIZER_WIDTH;
        const hb = {
          x: px,
          y: newBounds.y,
          width: panelW,
          height: SECONDARY_SEARCH_HEADER_HEIGHT,
        };
        panel.headerView.setBounds(hb);
        panel.headerBounds = hb;
        const cb = {
          x: px,
          y: newBounds.y + SECONDARY_SEARCH_HEADER_HEIGHT,
          width: panelW,
          height: Math.max(
            0,
            newBounds.height - SECONDARY_SEARCH_HEADER_HEIGHT,
          ),
        };
        panel.browserView.setBounds(cb);
        panel.bounds = cb;
        ssp.resizerView.setBounds({
          x: newBounds.x + newBounds.width,
          y: newBounds.y,
          width: RESIZER_WIDTH,
          height: newBounds.height,
        });
      }
    }

    // 同值守卫同时比对「账本 bounds」与「原生真实 bounds」:历史上 autoResize 会
    // 绕过 View.setBounds 直接改原生 bounds,导致账本说没变而真实尺寸早已漂移
    // (最小化/还原后页面卡在还原态宽度)。读真实值保证任何来源的漂移都会在下一
    // 次 fixBounds 被纠正。
    let realBounds: Electron.Rectangle | null = null;
    try {
      realBounds = view.browserView?.getBounds?.() ?? null;
    } catch {
      realBounds = null;
    }
    const differsFromLedger =
      !view.bounds ||
      newBounds.x !== view.bounds.x ||
      newBounds.y !== view.bounds.y ||
      newBounds.width !== view.bounds.width ||
      newBounds.height !== view.bounds.height;
    const differsFromReal =
      !realBounds ||
      newBounds.x !== realBounds.x ||
      newBounds.y !== realBounds.y ||
      newBounds.width !== realBounds.width ||
      newBounds.height !== realBounds.height;

    if (differsFromLedger || differsFromReal) {
      // [RSZ] 排查日志(临时):fixBounds 决定改写页面 view 尺寸的时刻。
      const prev = view.bounds
        ? `${view.bounds.width}x${view.bounds.height}@${view.bounds.x},${view.bounds.y}`
        : 'null';
      console.log(
        `[RSZ] fixBounds APPLY view=${view.id} ${prev} real=${realBounds ? `${realBounds.width}x${realBounds.height}` : '?'} -> ` +
          `${newBounds.width}x${newBounds.height}@${newBounds.x},${newBounds.y}` +
          ` min=${this.window.win.isDestroyed() ? '?' : this.window.win.isMinimized()}`,
      );
      view.setBounds(newBounds);
      // 缓存最新内容区矩形,供下次 select() 同步预定位新视图(见 select())。
      this.lastContentBounds = newBounds;
    } else {
      // [RSZ] 排查日志(临时):同值守卫命中(尺寸没变,不该触发页面 resize)。
      console.log(
        `[RSZ] fixBounds SKIP view=${view.id} unchanged ` +
          `${newBounds.width}x${newBounds.height}@${newBounds.x},${newBounds.y}`,
      );
    }
  }

  private setBoundsListener() {
    // resize the BrowserView's bounds when the toolbar/sidebar size changes
    // ex: when the bookmarks bar appears, or the tab bar moves to a sidebar
    this.window.webContents.executeJavaScript(`
        const {ipcRenderer} = require('electron');
        let resizeFrame = 0;
        const resizeObserver = new ResizeObserver(() => {
          if (resizeFrame) return;
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            ipcRenderer.send('resize-height');
          });
        });
        const anchor = document.getElementById('view-anchor');
        const app = document.getElementById('app');
        if (anchor) resizeObserver.observe(anchor);
        if (app) resizeObserver.observe(app);
      `);

    this.window.webContents.on('ipc-message', (e, message) => {
      if (message === 'resize-height') {
        // [RSZ] 排查日志(临时):UI renderer 的 ResizeObserver 测到 #view-anchor
        // 尺寸变化(注意 rAF 门控:最小化期间 rAF 暂停,可能到还原后才送达)。
        console.log('[RSZ] resize-height IPC(UI anchor 变化)');
        this.fixBounds();
      }
    });
  }

  /**
   * 与 renderer 上报的标签顺序对账,销毁列表里已不存在的幽灵 view。
   *
   * renderer 的 tabs store 是标签列表的唯一权威(每次 list 变更都会经
   * crx-set-tab-order 重发全量 id)。主进程 views map 在个别路径下会残留
   * 已无 renderer 标签对应的 view(如关闭 IPC 丢失、崩溃恢复后 id 漂移),
   * 表现为:退出确认的「N 个打开的标签页」虚高、扩展 tabs.query 看到幽灵标签。
   *
   * 豁免:
   * - 冷启动预创建的初始 view(precreatedInitialViewId)在 renderer 领养前
   *   不在任何标签列表里,不能当幽灵销毁。
   * - 创建后 GHOST_VIEW_GRACE_MS 内的 view:create-tab IPC 在途、renderer 尚未
   *   把标签加入 list,此时对账可能误杀刚建好的标签(快速连开连关时尤甚)。
   *   幽灵 view 都是长期存活的,宽限期不影响清理效果。
   * - 占位标签的负数 id 不参与对账。
   */
  public reconcileWithRendererOrder(orderedTabIds: number[]) {
    if (this.window.win.isDestroyed()) return;
    this.rendererTabIds = orderedTabIds.slice();
    const liveIds = new Set(
      orderedTabIds.filter((id) => Number.isInteger(id) && id >= 0),
    );

    // 空列表也继续对账:最后一个真实标签关闭/迁出后 renderer 会上报 [],此时
    // 残留的幽灵 view 必须被清掉,否则 closeIfEmpty() 看到 views.size>0 会泄漏
    // 空窗口与 BrowserView。误杀风险由两层豁免兜住——precreated 初始 view(领养前
    // 必然不在列表)与新建 view 的 10s 宽限期(启动恢复期 / 迁出并发窗口全覆盖)。
    const now = Date.now();
    for (const id of Array.from(this.views.keys())) {
      if (id === this.precreatedInitialViewId) continue;
      if (liveIds.has(id)) continue;
      const createdAt = this.lastActiveAt.get(id) || 0;
      if (createdAt && now - createdAt < ViewManager.GHOST_VIEW_GRACE_MS) continue;
      console.warn(
        `[view-manager] reconciling ghost view id=${id} url=${this.views.get(id)?.url}`,
      );
      this.destroy(id);
    }
  }

  public destroy(id: number) {
    const view = this.views.get(id);

    this.views.delete(id);
    this.lastActiveAt.delete(id);

    // 关闭标签时销毁其对应的扩展 sidePanel 面板
    this.window.sidePanels?.onTabRemoved(id);

    // 关闭标签时销毁其对应的「双引擎搜索」面板
    this.window.secondarySearchPanels?.onTabRemoved(id);

    // 捕获被关标签所在渲染进程的 OS pid(销毁后取不到),用于事后清理同进程残留缓存。
    let closedPid = -1;
    try {
      if (view && !view.browserView.webContents.isDestroyed()) {
        closedPid = view.browserView.webContents.getOSProcessId();
      }
    } catch {
      // 延迟标签无 webContents 等,忽略
    }

    if (view && !view.browserView.webContents.isDestroyed()) {
      view.detachFromWindow();
      view.destroy();
      this.emit('removed', id);
    }

    // [内存节省] --process-per-site 下同站点标签共享一个渲染进程:关掉一个标签不会
    // 结束该进程,被关标签在进程级内存缓存(解码图片/字体等 Blink MemoryCache)里的
    // 资源会滞留到 GC。这里让「同进程仍存活」的标签各清一次缓存,促使渲染进程立即回收
    // 被关标签留下的缓存。若被关标签独占进程(未开 process-per-site 时的常态),进程随
    // 之结束、无同进程幸存者,此调用自然空转,不影响其它标签。
    if (closedPid > 0) {
      // 略延后:等被关标签的帧在共享进程里完成拆除,再让同进程幸存标签清缓存,
      // 才能可靠回收其滞留的进程级缓存(立即清可能漏掉仍在拆除中的资源)。
      setTimeout(() => this.releaseCacheForProcess(closedPid), 200).unref?.();
    }
  }

  /**
   * 后台 renderer 崩溃时释放真实 View，保留 renderer 侧同位置的 discarded
   * 占位标签；该占位标签被选中时会复用 loadDiscardedTab 的标准创建流程。
   */
  public discardCrashedView(id: number, url: string) {
    const view = this.views.get(id);
    if (!view || this.selectedId === id) return false;

    const payload = {
      id,
      url: url || view.url || view.homeUrl || '',
      title: view.title,
      favicon: view.favicon,
    };
    this.window.send('discard-crashed-tab', payload);
    this.destroy(id);
    console.warn(`[tab-crash] discarded background view=${id} url=${payload.url}`);
    return true;
  }

  // 让所有「仍存活且与给定 OS pid 同进程」的标签释放内存缓存(webFrame.clearCache),
  // 回收共享渲染进程里已关标签滞留的进程级缓存。见 destroy() 与 view-preload 的
  // `tab-release-memory` 监听。跨所有窗口检索(process-per-site 合并跨窗口同源标签)。
  private releaseCacheForProcess(pid: number) {
    for (const appWindow of Application.instance?.windows?.list || []) {
      const vm = appWindow?.viewManager;
      if (!vm) continue;
      for (const [, v] of vm.views) {
        try {
          const wc = v?.webContents;
          if (!wc || wc.isDestroyed()) continue;
          if (wc.getOSProcessId() === pid) {
            wc.send('tab-release-memory');
          }
        } catch {
          // 单个标签取 pid/发送失败不影响其它
        }
      }
    }
  }

  public emitZoomUpdate(showDialog = true) {
    Application.instance.dialogs
      .getDynamic('zoom')
      ?.browserView?.webContents?.send(
      'zoom-factor-updated',
      this.selected.webContents.zoomFactor,
    );

    // QuickMenu 弹窗内的缩放显示同步
    Application.instance.dialogs
      .getExistingPersistent('menu')
      ?.browserView?.webContents?.send(
      'zoom-factor-updated',
      this.selected.webContents.zoomFactor,
    );

    this.window.webContents.send(
      'zoom-factor-updated',
      this.selected.webContents.zoomFactor,
      showDialog,
    );
  }
}
