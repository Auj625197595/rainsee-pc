import { ipcMain, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { Application } from '../application';
import { getPath } from '~/utils';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as http from 'http';
import * as https from 'https';
import { parse } from 'url';

// 后端版本校验接口(ThinkPHP5 控制器 Version::check)
const UPDATE_CHECK_URL = 'https://api.yjllq.com/api/Version/check';

// 跳过版本持久化文件(放 userData 下,避免改动 settings schema)
const SKIP_FILE = 'update-skip.json';

// 以 UTF-8 拉取 JSON(requestURL 用 binary 编码会破坏中文更新说明,故单独实现)
const fetchJSON = (url: string): Promise<any> =>
  new Promise((resolve2, reject) => {
    const options = parse(url);
    const request = options.protocol === 'https:' ? https.request : http.request;
    const req = request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve2(JSON.parse(text));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

interface UpdateInfo {
  version: string;
  notes: string;
  feedUrl: string;
  mandatory: boolean;
  pubDate?: string;
}

// 缓存的可更新信息(校验到新版本后填充)
let pendingUpdate: UpdateInfo | null = null;
// 是否已配置 feed 并开始过下载,避免重复
let updaterStarted = false;

const readSkippedVersion = async (): Promise<string> => {
  try {
    const raw = await fs.readFile(resolve(getPath(SKIP_FILE)), 'utf8');
    return JSON.parse(raw).version || '';
  } catch {
    return '';
  }
};

const writeSkippedVersion = async (version: string) => {
  try {
    await fs.writeFile(
      resolve(getPath(SKIP_FILE)),
      JSON.stringify({ version }),
      'utf8',
    );
  } catch (e) {
    console.error('[auto-updater] write skip file failed', e);
  }
};

// 语义化版本比较: a > b 返回 1, a < b 返回 -1, 相等返回 0
const compareVersion = (a: string, b: string): number => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

// 向所有浏览器窗口及菜单弹窗广播更新可用
const broadcastUpdateAvailable = (info: UpdateInfo) => {
  const payload = { version: info.version, notes: info.notes };
  Application.instance.windows.broadcast('update-available', payload);
  Application.instance.dialogs
    .getPersistent('menu')
    ?.webContents?.send('update-available', payload);
};

// 启动时校验一次
const checkOnStartup = async () => {
  try {
    const json = await fetchJSON(UPDATE_CHECK_URL);
    if (!json || json.code !== 0 || !json.data) return;

    const data = json.data;
    const latest: UpdateInfo = {
      version: String(data.version || ''),
      notes: String(data.notes || ''),
      feedUrl: String(data.feed_url || ''),
      mandatory: !!data.mandatory,
      pubDate: data.pub_date,
    };

    if (!latest.version) return;

    const current = app.getVersion();
    if (compareVersion(latest.version, current) <= 0) {
      // 已是最新
      return;
    }

    // 强制更新时忽略跳过记录
    if (!latest.mandatory) {
      const skipped = await readSkippedVersion();
      if (skipped && compareVersion(skipped, latest.version) >= 0) {
        // 用户已跳过该版本(或更高),不提示
        return;
      }
    }

    pendingUpdate = latest;
    broadcastUpdateAvailable(latest);
  } catch (e) {
    console.error('[auto-updater] startup check failed', e);
  }
};

// 配置 electron-updater 事件转发到更新弹窗
const wireUpdaterEvents = () => {
  // 不让 electron-updater 自动下载:checkForUpdates 命中 update-available 后由这里的
  // 监听显式触发 downloadUpdate(),使下载动作在本进程可追溯,并弱化"后台自动拉取可执行
  // 文件"的启发式特征。用户流程不变(点"立即更新"后即开始下载)。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const toDialog = (channel: string, ...args: any[]) => {
    Application.instance.dialogs
      .getPersistent('update')
      ?.webContents?.send(channel, ...args);
  };

  autoUpdater.on('update-available', () => {
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[auto-updater] downloadUpdate failed', err);
      toDialog('update-error', String(err && err.message ? err.message : err));
    });
  });

  autoUpdater.on('download-progress', (p) => {
    toDialog('update-download-progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    toDialog('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] updater error', err);
    toDialog('update-error', String(err && err.message ? err.message : err));
  });
};

export const runAutoUpdaterService = () => {
  let eventsWired = false;

  ipcMain.handle('is-update-available', () => {
    return !!pendingUpdate;
  });

  // 弹窗打开时拉取更新详情
  ipcMain.handle('get-update-info', () => {
    return {
      available: !!pendingUpdate,
      version: pendingUpdate?.version || '',
      notes: pendingUpdate?.notes || '',
      mandatory: pendingUpdate?.mandatory || false,
      currentVersion: app.getVersion(),
    };
  });

  // 跳过此版本
  ipcMain.handle('skip-update-version', async () => {
    if (pendingUpdate) {
      await writeSkippedVersion(pendingUpdate.version);
    }
    return true;
  });

  // 立即更新: 配置 feed -> 检查并下载, 完成后退出安装
  ipcMain.handle('start-update', async () => {
    if (!pendingUpdate || !pendingUpdate.feedUrl) {
      return { ok: false, error: '无可用更新或下载地址未配置' };
    }

    try {
      if (!eventsWired) {
        wireUpdaterEvents();
        eventsWired = true;
      }

      autoUpdater.setFeedURL({
        provider: 'generic',
        url: pendingUpdate.feedUrl,
      } as any);

      updaterStarted = true;
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      console.error('[auto-updater] start-update failed', e);
      return { ok: false, error: String(e && (e as any).message ? (e as any).message : e) };
    }
  });

  // 下载完成后, 由弹窗触发退出并安装
  ipcMain.handle('quit-and-install', () => {
    if (updaterStarted) {
      autoUpdater.quitAndInstall();
    }
    return true;
  });

  // 兼容旧的 update-check(渲染层 store 启动时仍会发)
  ipcMain.on('update-check', () => {
    checkOnStartup();
  });

  // 启动时主动校验一次
  checkOnStartup();
};
