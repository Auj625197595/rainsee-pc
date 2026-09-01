import {
  clipboard,
  Menu,
} from 'electron';
import { isURL, prefixHttp } from '~/utils';
import { saveAs, viewSource, printPage } from './common-actions';
import {Application} from "~/main/application";
import { getMainTranslator } from '~/main/i18n';

export const getViewMenu = (
  params: Electron.ContextMenuParams,
  webContents: Electron.WebContents,
) => {
  const t = getMainTranslator(
    Application.instance.settings?.object?.language,
  );
  let menuItems: Electron.MenuItemConstructorOptions[] = [];

  if (params.linkURL !== '') {
    menuItems = menuItems.concat([
      {
        label: t('openInNewTab'),
        click: () => {
          Application.instance.windows.current.viewManager.create(
            {
              url: params.linkURL,
              active: false,
            },
            true,
          );
        },
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
      {
        type: 'separator',
      },
    ]);
  }

  if (params.hasImageContents) {
    menuItems = menuItems.concat([
      {
        label: t('menuOpenImageNewTab'),
        click: () => {
          Application.instance.windows.current.viewManager.create(
            {
              url: params.srcURL,
              active: false,
            },
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

  if (!params.isEditable && params.selectionText !== '') {
    menuItems = menuItems.concat([
      {
        role: 'copy',
        accelerator: 'CmdOrCtrl+C',
        label: t('menuCopy')
      },
      {
        type: 'separator',
      },
    ]);
  }

  if (params.selectionText !== '') {
    const trimmedText = params.selectionText.trim();

    if (isURL(trimmedText)) {
      menuItems = menuItems.concat([
        {
          label: t('goToSelection', { text: trimmedText }),
          click: () => {
            Application.instance.windows.current.viewManager.create(
              {
                url: prefixHttp(trimmedText),
                active: true,
              },
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
    params.selectionText === '' &&
    !params.isEditable
  ) {
    menuItems = menuItems.concat([
      {
        label: t('shortcutBack'),
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
        label: t('shortcutReload'),
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          webContents.reload();
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('shortcutSavePage'),
        accelerator: 'CmdOrCtrl+S',
        click: async () => {
          saveAs();
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
    label: t('inspect'),
    accelerator: 'CmdOrCtrl+Shift+I',
    click: () => {
      webContents.inspectElement(params.x, params.y);

      if (webContents.isDevToolsOpened()) {
        webContents.devToolsWebContents.focus();
      }
    },
  });

  return Menu.buildFromTemplate(menuItems);
};
