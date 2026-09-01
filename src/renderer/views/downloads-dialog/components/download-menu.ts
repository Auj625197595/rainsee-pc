import { clipboard, ipcRenderer, shell } from 'electron';
import * as remote from '@electron/remote';
import { createLocaleTranslator } from '~/common/i18n';
import { IDownloadItem } from '~/interfaces';

// 下载项操作:供「⋯」下拉菜单(DownloadItemMenu)与右键原生菜单共用,
// 保证两处入口的行为始终一致。

export const openItem = (item: IDownloadItem) => {
  if (item.completed) shell.openPath(item.savePath);
};

export const toggleOpenWhenDone = (item: IDownloadItem) => {
  ipcRenderer.send('download-open-when-done', item.id);
};

export const showInFolder = (item: IDownloadItem) => {
  remote.shell.showItemInFolder(item.savePath);
};

export const copyLink = (item: IDownloadItem) => {
  clipboard.writeText(item.url);
};

export const pauseDownload = (item: IDownloadItem) => {
  ipcRenderer.send('download-pause', item.id);
};

export const resumeDownload = (item: IDownloadItem) => {
  ipcRenderer.send('download-resume', item.id);
};

export const cancelDownload = (item: IDownloadItem) => {
  ipcRenderer.send('download-cancel', item.id);
};

export const removeDownload = (item: IDownloadItem) => {
  ipcRenderer.send('download-remove', item.id);
};

export const trashDownload = (item: IDownloadItem) => {
  ipcRenderer
    .invoke('download-trash', item.id)
    .then((result: { ok: boolean }) => {
      if (!result?.ok) throw new Error('Unable to trash download');
    })
    .catch(() => {
      // 文件可能正被占用或无删除权限,提示用户而不是静默失败。
      const t = createLocaleTranslator(undefined);
      remote.dialog.showMessageBox(remote.getCurrentWindow(), {
        title: t('dldDeleteFailedTitle'),
        buttons: [t('dldDeleteFailedClose')],
        type: 'warning',
        message: t('dldDeleteFailedMsg'),
      });
    });
};

// 构建原生右键菜单模板(与 DownloadItemMenu 下拉项一一对应)。
export const getDownloadMenuTemplate = (
  item: IDownloadItem,
): Electron.MenuItemConstructorOptions[] => {
  const t = createLocaleTranslator(undefined);
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (!item.canceled) {
    if (item.completed) {
      template.push({ label: t('dldOpenFile'), click: () => openItem(item) });
    } else {
      template.push({
        type: 'checkbox',
        label: t('dldOpenWhenDone'),
        checked: !!item.openWhenDone,
        click: () => toggleOpenWhenDone(item),
      });
    }
    template.push({ type: 'separator' });
  }

  if (!item.completed && !item.canceled) {
    template.push(
      item.paused && !item.retrying
        ? { label: t('dldResume'), click: () => resumeDownload(item) }
        : { label: t('dldPause'), click: () => pauseDownload(item) },
    );
  }

  if (!item.canceled) {
    template.push({
      label: t('dldShowInFolder'),
      click: () => showInFolder(item),
    });
  }

  template.push({ label: t('dldCopyLink'), click: () => copyLink(item) });
  template.push({ type: 'separator' });

  if (item.completed) {
    template.push({ label: t('dldDeleteFile'), click: () => trashDownload(item) });
  }

  if (item.completed || item.canceled) {
    template.push({
      label: t('dldRemoveFromList'),
      click: () => removeDownload(item),
    });
  } else {
    template.push({ label: t('dldCancelDownload'), click: () => cancelDownload(item) });
  }

  return template;
};
