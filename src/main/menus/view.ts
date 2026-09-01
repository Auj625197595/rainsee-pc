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
import { getMainTranslator } from '../i18n';
import { ShareDialog } from '../dialogs/share';
import {
  DOWNLOADER_PRESETS,
  launchExternalDownload,
} from '../services/external-downloader';

// 在新的(可选无痕)应用窗口中打开 URL。
// 无痕场景复用已存在的无痕窗口(Chrome 行为),没有再新开;普通场景总是新开窗口。
// 注意:viewManager.create 内部按所属窗口的 incognito 决定会话(忽略 details.incognito),
// 故无痕与否完全由 windows.open(incognitoWindow) 创建的目标窗口决定。
const openUrlInNewWindow = (url: string, incognitoWindow: boolean) => {
  // 复用已有无痕窗口:renderer 已就绪,直接建标签并 select。
  const existing = incognitoWindow
    ? Application.instance.windows.list.find(
        (w) => w.incognito && !w.win.isDestroyed(),
      )
    : undefined;
  if (existing) {
    existing.viewManager.create({url, active: true} as any, true, true);
    existing.win.focus();
    return;
  }

  // 新开窗口:把 URL 作为窗口的 initialUrl 注入。新窗口的 startup-tabs 会优先打开它
  // (而非默认 newtab),既保证建标签发生在 renderer 就绪后,又避免 startup 的 newtab
  // select 覆盖目标标签。详见 startup-tabs.ts 与 windows/app.ts。
  const appWin = Application.instance.windows.open(incognitoWindow, url);
  appWin.win.focus();
};

export const getViewMenu = (
  appWindow: AppWindow,
  params: Electron.ContextMenuParams,
  webContents: Electron.WebContents,
  incognito = false,
) => {
  const t = getMainTranslator(
    Application.instance.settings?.object?.language,
  );
  let menuItems: Electron.MenuItemConstructorOptions[] = [];
  // 覆盖页没有独立的 renderer tab 模型，按物理 WebContents 找回根标签。
  const view = appWindow.viewManager.findViewByWebContentsId(webContents.id);
  const trimmedSelectionText = params.selectionText.trim();
  const hasSelectionText = trimmedSelectionText !== '';

  if (params.linkURL !== '') {
    menuItems = menuItems.concat([
      {
        label: t('ctxOpenLinkNewTab'),
        click: () => {
          appWindow.viewManager.create(
            {
              url: params.linkURL,
              active: true,
              incognito,
            } as any,
            true,
          );
        },
      },
      {
        label: t('ctxOpenLinkNewTabBg'),
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
        label: t('ctxOpenLinkNewWindow'),
        click: () => openUrlInNewWindow(params.linkURL, false),
      },
      {
        label: t('ctxOpenLinkIncognito'),
        click: () => openUrlInNewWindow(params.linkURL, true),
      },
      {
        type: 'separator',
      },
      {
        label: t('copyLinkAddress'),
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
        DOWNLOADER_PRESETS[dlSettings.downloaderType]?.name ??
        t('ctxUseExternalDownloader');
      menuItems.push(
        {type: 'separator'},
        {
          label: isBlobLink ? t('ctxDownloadFile') : t('ctxDownloadWith', {name: presetName}),
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
        label: t('menuOpenImageNewTab'),
        click: () => {
          appWindow.viewManager.create(
            {
              url: params.srcURL,
              active: true,
              incognito,
            } as any,
            true,
          );
        },
      },
      {
        label: t('ctxOpenImageNewTabBg'),
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
        label: t('copyImage'),
        click: () => webContents.copyImageAt(params.x, params.y),
      },
      {
        label: t('copyImageAddress'),
        click: () => {
          clipboard.clear();
          clipboard.writeText(params.srcURL);
        },
      },
      {
        label: t('saveImageAs'),
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
        label: t('menuUndo'),
      },
      {
        role: 'redo',
        accelerator: 'CmdOrCtrl+Shift+Z',
        label: t('menuRedo'),
      },
      {
        type: 'separator',
      },
      {
        role: 'cut',
        accelerator: 'CmdOrCtrl+X',
        label: t('menuCut'),
      },
      {
        role: 'copy',
        accelerator: 'CmdOrCtrl+C',
        label: t('menuCopy'),
      },
      {
        role: 'pasteAndMatchStyle',
        accelerator: 'CmdOrCtrl+V',
        label: t('menuPaste'),
      },
      {
        role: 'paste',
        accelerator: 'CmdOrCtrl+Shift+V',
        label: t('pasteAsText'),
      },
      {
        role: 'selectAll',
        accelerator: 'CmdOrCtrl+A',
        label: t('menuSelectAll'),
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
        label: t('menuCopy')
      },
      {
        label: t('ctxCopyAsMarkdown'),
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
    const settings = Application.instance.settings.object;
    const searchEngine =
      settings.searchEngines?.[settings.searchEngine] ||
      settings.searchEngines?.[0];
    const searchEngineName = searchEngine?.name?.trim();

    menuItems = menuItems.concat([
      {
        label:  t('stSearch'),
        click: () => {
          const keyword = encodeURIComponent(trimmedSelectionText);
          const url = searchEngine?.url
            ? searchEngine.url.replace('%s', keyword)
            : `https://www.google.com/search?q=${keyword}`;

          appWindow.viewManager.create({url, active: true});
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
          label: t('goToSelection', {text: trimmedText}),
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
        label: t('backAction'),
        accelerator: 'Alt+Left',
        enabled: webContents.canGoBack(),
        click: () => {
          webContents.goBack();
        },
      },
      {
        label: t('shortcutForward'),
        accelerator: 'Alt+Right',
        enabled: webContents.canGoForward(),
        click: () => {
          webContents.goForward();
        },
      },
      {
        label: t('extReload'),
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          webContents.reload();
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('ctxOpenInNewWindow'),
        click: () => openUrlInNewWindow(webContents.getURL(), false),
      },
      {
        label: t('ctxOpenInIncognito'),
        click: () => openUrlInNewWindow(webContents.getURL(), true),
      },
      {
        type: 'separator',
      },
      {
        label: t('ctxSavePageAs'),
        accelerator: 'CmdOrCtrl+S',
        click: async () => {
          saveAs();
        },
      },
      {
        label: t('ctxCopyPageAs'),
        click: async () => {
          copyPageAsMarkdown();
        },
      },
      {
        label: t('shortcutPrint'),
        accelerator: 'CmdOrCtrl+P',
        click: async () => {
          printPage();
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('shortcutViewSource'),
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
    label: t('ctxTranslatePage'),
    click: () => {
      Application.instance.windows.current.viewManager.selected?.startTranslation(true);
    },
  });

  // 看图模式:收集当前网页所有图片,在新标签页打开图片浏览器(黑色背景,grid/list,多选下载)。
  menuItems.push({
    label: t('ctxImageViewer'),
    click: () => {
      enterImageViewer(webContents);
    },
  });

  // 分享当前网页:弹出二维码 + 短链窗口(与标签右键/QuickMenu 同一弹窗)。
  menuItems.push({
    label: t('tcmShare'),
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
        label: t('ctxOpenLinksNewTab'),
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
      label: t('inspect'),
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
