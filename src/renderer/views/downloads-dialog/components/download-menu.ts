import { clipboard, ipcRenderer, shell } from 'electron';
import * as remote from '@electron/remote';
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
      remote.dialog.showMessageBox(remote.getCurrentWindow(), {
        title: '无法删除文件',
        buttons: ['关闭'],
        type: 'warning',
        message:
          '无法执行操作，可能文件已打开，或您没有删除权限。\n\n请关闭文件后重试。',
      });
    });
};

// 构建原生右键菜单模板(与 DownloadItemMenu 下拉项一一对应)。
export const getDownloadMenuTemplate = (
  item: IDownloadItem,
): Electron.MenuItemConstructorOptions[] => {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (!item.canceled) {
    if (item.completed) {
      template.push({ label: '打开文件', click: () => openItem(item) });
    } else {
      template.push({
        type: 'checkbox',
        label: '完成时打开',
        checked: !!item.openWhenDone,
        click: () => toggleOpenWhenDone(item),
      });
    }
    template.push({ type: 'separator' });
  }

  if (!item.completed && !item.canceled) {
    template.push(
      item.paused && !item.retrying
        ? { label: '恢复下载', click: () => resumeDownload(item) }
        : { label: '暂停下载', click: () => pauseDownload(item) },
    );
  }

  if (!item.canceled) {
    template.push({
      label: '在文件夹中显示',
      click: () => showInFolder(item),
    });
  }

  template.push({ label: '复制下载链接', click: () => copyLink(item) });
  template.push({ type: 'separator' });

  if (item.completed) {
    template.push({ label: '删除文件', click: () => trashDownload(item) });
  }

  if (item.completed || item.canceled) {
    template.push({
      label: '从列表中移除',
      click: () => removeDownload(item),
    });
  } else {
    template.push({ label: '取消下载', click: () => cancelDownload(item) });
  }

  return template;
};
