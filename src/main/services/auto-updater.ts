import { ipcMain, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { Application } from '../application';

interface UpdateInfo {
  version: string;
  notes: string;
}

// 缓存的可更新信息(校验到新版本后填充)
let pendingUpdate: UpdateInfo | null = null;
// 事件是否已接线(electron-updater 只需配置一次)
let eventsWired = false;

// releaseNotes 可能是字符串或 ReleaseNoteInfo[],统一取纯文本
const notesText = (notes: any): string => {
  if (!notes) return '';
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes.map((n) => n?.note || '').filter(Boolean).join('\n');
  }
  return '';
};

// 向所有浏览器窗口及菜单弹窗广播更新可用
const broadcastUpdateAvailable = (info: UpdateInfo) => {
  const payload = { version: info.version, notes: info.notes };
  Application.instance.windows.broadcast('update-available', payload);
  Application.instance.dialogs
    .getExistingPersistent('menu')
    ?.webContents?.send('update-available', payload);
};

const forwardToDialog = (channel: string, ...args: any[]) => {
  Application.instance.dialogs
    .getExistingPersistent('update')
    ?.webContents?.send(channel, ...args);
};

// 配置 electron-updater 事件转发到更新弹窗
const wireUpdaterEvents = () => {
  // 不让 electron-updater 自动下载:发现新版本后先广播通知,
  // 用户点"立即更新"时再由 start-update 显式触发下载。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 更新源由 electron-builder.json 的 publish: github 在打包时写入 app-update.yml。
  // 开发态未打包时 checkForUpdates 会失败,静默忽略即可。

  autoUpdater.on('update-available', (info: any) => {
    pendingUpdate = {
      version: String(info?.version || ''),
      notes: notesText(info?.releaseNotes),
    };
    if (pendingUpdate.version) {
      broadcastUpdateAvailable(pendingUpdate);
    }
  });

  autoUpdater.on('download-progress', (p) => {
    forwardToDialog('update-download-progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    forwardToDialog('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] updater error', err);
    forwardToDialog('update-error', String(err && err.message ? err.message : err));
  });
};

export const runAutoUpdaterService = () => {
  let started = false;

  const checkForUpdatesOnce = async () => {
    try {
      if (!eventsWired) {
        wireUpdaterEvents();
        eventsWired = true;
      }
      await autoUpdater.checkForUpdates();
      started = true;
    } catch (e) {
      console.error('[auto-updater] check failed', e);
    }
  };

  // Application 在启动早期注册了兜底 handler，避免菜单先于本延迟服务创建时
  // 调用 IPC 失败。服务就绪后用真实更新状态替换该兜底值。
  ipcMain.removeHandler('is-update-available');
  ipcMain.handle('is-update-available', () => {
    return !!pendingUpdate;
  });

  // 弹窗打开时拉取更新详情
  ipcMain.handle('get-update-info', () => {
    return {
      available: !!pendingUpdate,
      version: pendingUpdate?.version || '',
      notes: pendingUpdate?.notes || '',
      mandatory: false,
      currentVersion: app.getVersion(),
    };
  });

  // 跳过此版本: 本地直接关闭弹窗即可,无需持久化记录
  ipcMain.handle('skip-update-version', async () => {
    pendingUpdate = null;
    return true;
  });

  // 立即更新: 检查并下载, 完成后退出安装
  ipcMain.handle('start-update', async () => {
    try {
      if (!started) {
        await checkForUpdatesOnce();
        if (!pendingUpdate) {
          return { ok: false, error: '暂无可用更新' };
        }
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      console.error('[auto-updater] start-update failed', e);
      return { ok: false, error: String(e && (e as any).message ? (e as any).message : e) };
    }
  });

  // 下载完成后, 由弹窗触发退出并安装
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
    return true;
  });

  // 兼容旧的 update-check(渲染层 store 启动时仍会发)
  ipcMain.on('update-check', () => {
    checkForUpdatesOnce();
  });

  // 启动时校验一次
  checkForUpdatesOnce();
};
