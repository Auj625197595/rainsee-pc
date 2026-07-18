import { AppWindow } from '../windows';
import {
  clipboard,
  nativeImage,
  Menu,
  MenuItem,
  session,
  ipcMain,
  BrowserView,
} from 'electron';
import { isURL, prefixHttp } from '~/utils';
import { saveAs, viewSource, printPage, copyPageAsMarkdown } from './common-actions';
import { enterImageViewer } from '../services/image-viewer';
import { Application } from '../application';
import { ShareDialog } from '../dialogs/share';
import {
  DOWNLOADER_PRESETS,
  launchExternalDownload,
} from '../services/external-downloader';

export const getViewMenu = (
  appWindow: AppWindow,
  params: Electron.ContextMenuParams,
  webContents: Electron.WebContents,
  incognito = false,
) => {
  let menuItems: Electron.MenuItemConstructorOptions[] = [];
  const view = appWindow.viewManager.getById(webContents.id);
  const trimmedSelectionText = params.selectionText.trim();
  const hasSelectionText = trimmedSelectionText !== '';

  if (params.linkURL !== '') {
    menuItems = menuItems.concat([
      {
        label: '在新标签页打开链接',
        click: () => {
          appWindow.viewManager.create(
            {
              url: params.linkURL,
              active: false,
              incognito,
            } as any,
            true,
          );
        },
      },
      {
        type: 'separator',
      },
      {
        label: '复制链接地址',
        click: () => {
          clipboard.clear();
          clipboard.writeText(params.linkURL);
        },
      },
    ]);

    // 外部下载器:开启时在链接右键菜单加"使用 XX 下载"。
    const dlSettings = Application.instance.settings.object;
    if (dlSettings.downloaderEnabled) {
      const isBlobLink = params.linkURL.toLowerCase().startsWith('blob:');
      const presetName =
        DOWNLOADER_PRESETS[dlSettings.downloaderType]?.name ?? '外部下载器';
      menuItems.push(
        {type: 'separator'},
        {
          label: isBlobLink ? '下载文件' : `使用${presetName}下载`,
          click: () => {
            if (isBlobLink) {
              webContents.downloadURL(params.linkURL);
              return;
            }
            launchExternalDownload({
              type: dlSettings.downloaderType,
              customPath: dlSettings.downloaderPath,
              customArgs: dlSettings.downloaderArgs,
              url: params.linkURL,
              path: dlSettings.downloadsPath,
            });
          },
        },
      );
    }

    menuItems.push({type: 'separator'});
  }

  if (params.hasImageContents) {
    menuItems = menuItems.concat([
      {
        label: '在新标签页打开图片',
        click: () => {
          appWindow.viewManager.create(
            {
              url: params.srcURL,
              active: false,
              incognito,
            } as any,
            true,
          );
        },
      },
      {
        label: '复制图片',
        click: () => webContents.copyImageAt(params.x, params.y),
      },
      {
        label: '复制图片地址',
        click: () => {
          clipboard.clear();
          clipboard.writeText(params.srcURL);
        },
      },
      {
        label: '保存图片为...',
        click: () => {
          // Blob images belong to the page renderer; using the browser chrome
          // WebContents loses their in-memory payload.
          webContents.downloadURL(params.srcURL);
        },
      },
      {
        type: 'separator',
      },
    ]);
  }

  if (params.isEditable) {
    menuItems = menuItems.concat([
      {
        role: 'undo',
        accelerator: 'CmdOrCtrl+Z',
        label: '撤销',
      },
      {
        role: 'redo',
        accelerator: 'CmdOrCtrl+Shift+Z',
        label: '重做',
      },
      {
        type: 'separator',
      },
      {
        role: 'cut',
        accelerator: 'CmdOrCtrl+X',
        label: '剪切',
      },
      {
        role: 'copy',
        accelerator: 'CmdOrCtrl+C',
        label: '复制',
      },
      {
        role: 'pasteAndMatchStyle',
        accelerator: 'CmdOrCtrl+V',
        label: '粘贴',
      },
      {
        role: 'paste',
        accelerator: 'CmdOrCtrl+Shift+V',
        label: '粘贴为文本',
      },
      {
        role: 'selectAll',
        accelerator: 'CmdOrCtrl+A',
        label: '选择全部',
      },
      {
        type: 'separator',
      },
    ]);
  }

  if (!params.isEditable && hasSelectionText) {
    menuItems = menuItems.concat([
      {
        role: 'copy',
        accelerator: 'CmdOrCtrl+C',
        label: '复制'
      },
      {
        label: '复制为 Markdown',
        click: async () => {
          copyPageAsMarkdown();
        },
      },
      {
        type: 'separator',
      },
    ]);
  }

  if (hasSelectionText) {
    const trimmedText = trimmedSelectionText;

    if (isURL(trimmedText)) {
      menuItems = menuItems.concat([
        {
          label: '转到 ' + trimmedText,
          click: () => {
            appWindow.viewManager.create(
              {
                url: prefixHttp(trimmedText),
                active: true,
                incognito,
              } as any,
              true,
            );
          },
        },
        {
          type: 'separator',
        },
      ]);
    }
  }

  if (
    !params.hasImageContents &&
    params.linkURL === '' &&
    !hasSelectionText &&
    !params.isEditable
  ) {
    menuItems = menuItems.concat([
      {
        label: '返回',
        accelerator: 'Alt+Left',
        enabled: webContents.canGoBack(),
        click: () => {
          webContents.goBack();
        },
      },
      {
        label: '前进',
        accelerator: 'Alt+Right',
        enabled: webContents.canGoForward(),
        click: () => {
          webContents.goForward();
        },
      },
      {
        label: '重新加载',
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          webContents.reload();
        },
      },
      {
        type: 'separator',
      },
      {
        label: '保存页面为...',
        accelerator: 'CmdOrCtrl+S',
        click: async () => {
          saveAs();
        },
      },
      {
        label: '复制网页为 Markdown',
        click: async () => {
          copyPageAsMarkdown();
        },
      },
      {
        label: '打印',
        accelerator: 'CmdOrCtrl+P',
        click: async () => {
          printPage();
        },
      },
      {
        type: 'separator',
      },
      {
        label: '查看网页源代码',
        accelerator: 'CmdOrCtrl+U',
        click: () => {
          viewSource();
        },
      },
    ]);
  }

  menuItems.push({
    type: 'separator',
  });

  // 翻译此页:开启翻译并把本站加入"始终显示翻译图标"列表(与菜单「翻译」同通道)。
  menuItems.push({
    label: '翻译此页',
    click: () => {
      Application.instance.windows.current.viewManager.selected?.startTranslation(true);
    },
  });

  // 看图模式:收集当前网页所有图片,在新标签页打开图片浏览器(黑色背景,grid/list,多选下载)。
  menuItems.push({
    label: '看图模式',
    click: () => {
      enterImageViewer(webContents);
    },
  });

  // 分享当前网页:弹出二维码 + 短链窗口(与标签右键/QuickMenu 同一弹窗)。
  menuItems.push({
    label: '分享',
    click: () => {
      const dialog = Application.instance.dialogs.getPersistent(
        'share',
      ) as ShareDialog;
      dialog.open(appWindow.win, {
        url: webContents.getURL(),
        title: webContents.getTitle(),
      });
    },
  });

  if (view?.canToggleOpenLinksInNewPage()) {
    menuItems.push(
      {
        type: 'checkbox',
        label: '此网站所有链接在新页面打开',
        checked: !!view.openLinksInNewPageEnabled,
        click: (item) => {
          view.setOpenLinksInNewPageRule(!!item.checked).catch(() => undefined);
        },
      },
      {
        type: 'separator',
      },
    );
  }

  // 注入扩展通过 chrome.contextMenus 创建的右键菜单项。
  let extensionMenuItems: Electron.MenuItem[] = [];
  try {
    extensionMenuItems =
      Application.instance.sessions.chromeExtensions?.getContextMenuItems(
        webContents,
        params,
      ) ?? [];
  } catch (err) {
    console.error('[view-menu] failed to build extension context menu items', err);
  }

  const menu = Menu.buildFromTemplate(menuItems);

  if (extensionMenuItems.length > 0) {
    extensionMenuItems.forEach((item) => menu.append(item));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  menu.append(
    new MenuItem({
      label: '检查',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => {
        webContents.inspectElement(params.x, params.y);

        if (webContents.isDevToolsOpened()) {
          webContents.devToolsWebContents.focus();
        }
      },
    }),
  );

  return menu;
};
