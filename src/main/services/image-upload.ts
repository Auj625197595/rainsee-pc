import { app, ipcMain, WebContents } from 'electron';
import { promises as fsPromises } from 'fs';
import { basename, join } from 'path';
import { pathToFileURL } from 'url';

import { getWebUIURL } from '~/common/webui-main';
import { Application } from '../application';
import type { ImageUploadDialog } from '../dialogs/image-upload';

// 图片上传拦截:网页 preload 在 <input type=file> change 时把图片字节交上来,
// 主进程弹 image-upload 弹窗,由弹窗渲染层完成压缩/裁剪后把结果回传,再 resolve
// 给 preload 写回 input。update-settings 广播到不了普通网页,配置单独广播。

export interface ImageUploadFile {
  name: string;
  type: string;
  bytes: Uint8Array;
  lastModified?: number;
}

export interface ImageUploadRequest {
  files: ImageUploadFile[];
  accept: string;
  multiple: boolean;
  host: string;
}

export interface ImageUploadResult {
  action: 'upload' | 'cancel' | 'original';
  files?: ImageUploadFile[];
}

export interface ImageUploadConfig {
  enabled: boolean;
  bypassSites: string[];
  language?: unknown;
}

interface PendingRequest {
  requestId: number;
  sender: WebContents;
  host: string;
  resolve: (result: ImageUploadResult) => void;
  cleanup: () => void;
}

const settingsObject = () => Application.instance.settings.object;

const buildConfig = (): ImageUploadConfig => {
  const s = settingsObject();
  return {
    enabled: s.imageUploadInterceptEnabled !== false,
    bypassSites: Array.isArray(s.imageUploadBypassSites)
      ? s.imageUploadBypassSites
      : [],
    language: s.language,
  };
};

const broadcastConfig = () => {
  const cfg = buildConfig();
  for (const appWindow of Application.instance.windows.list) {
    try {
      appWindow.viewManager.views.forEach((v) => {
        if (!v.webContents.isDestroyed()) {
          v.webContents.send('image-upload-config-changed', cfg);
        }
      });
    } catch {
      // 窗口销毁中,忽略
    }
  }
};

const updateSettings = (patch: Record<string, unknown>) => {
  Application.instance.settings.updateSettings(patch as any);
  broadcastConfig();
};

const addBypassSite = (host: string) => {
  if (!host) return;
  const list = buildConfig().bypassSites;
  if (list.includes(host)) return;
  updateSettings({ imageUploadBypassSites: [...list, host] });
};

const openSettings = () => {
  const appWindow = Application.instance.windows.current;
  if (!appWindow) return false;
  appWindow.viewManager.create({
    url: `${getWebUIURL('settings')}?section=image-upload`,
    active: true,
  });
  return true;
};

let seq = 0;
let pending: PendingRequest | null = null;

const getDialog = () =>
  Application.instance.dialogs.getPersistent(
    'image-upload',
  ) as unknown as ImageUploadDialog;

const settle = (result: ImageUploadResult) => {
  const current = pending;
  if (!current) return;
  pending = null;
  current.cleanup();
  current.resolve(result);
};

// 本地图片压缩(超级拖拽面板「压缩」):复用同一弹窗,standalone 模式下主按钮是
// 「保存」(走浏览器下载),没有站点/拦截相关选项。下载由选中标签发起。
const STANDALONE_EXTS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export const isCompressibleImagePath = (filePath: string) =>
  !!STANDALONE_EXTS[(filePath.split('.').pop() || '').toLowerCase()];

export const openImageCompressor = async (
  appWindow: { win: Electron.BrowserWindow },
  filePaths: string[],
) => {
  const files: ImageUploadFile[] = [];
  for (const p of filePaths) {
    const type = STANDALONE_EXTS[(p.split('.').pop() || '').toLowerCase()];
    if (!type) continue;
    try {
      const stat = await fsPromises.stat(p);
      if (stat.size > 60 * 1024 * 1024) continue;
      files.push({
        name: basename(p),
        type,
        bytes: new Uint8Array(await fsPromises.readFile(p)),
        lastModified: stat.mtimeMs,
      });
    } catch (err) {
      console.warn('[image-compress] read failed', p, err);
    }
  }
  if (!files.length) return false;
  // 顶掉挂起的网页上传请求(按原图放行)。
  if (pending) settle({ action: 'original' });
  await getDialog().open(appWindow.win, {
    requestId: ++seq,
    standalone: true,
    files,
    accept: '',
    multiple: true,
    host: '',
  });
  return true;
};

export const setupImageUploadIpc = () => {
  ipcMain.on('get-image-upload-config-sync', (e) => {
    e.returnValue = buildConfig();
  });

  ipcMain.handle(
    'image-upload-intercept',
    async (e, request: ImageUploadRequest): Promise<ImageUploadResult> => {
      const sender = e.sender;
      const appWindow = Application.instance.windows.findByBrowserView(
        sender.id,
      );
      if (!appWindow || !request || !Array.isArray(request.files)) {
        return { action: 'original' };
      }
      // 只处理当前前台标签发起的请求;后台标签(脚本触发)直接放行。
      if (appWindow.viewManager.selected?.webContents?.id !== sender.id) {
        return { action: 'original' };
      }

      // 同一时间只有一个弹窗:新请求顶掉旧请求(旧的按原图放行,不阻塞旧页面)。
      if (pending) settle({ action: 'original' });

      const requestId = ++seq;
      return new Promise<ImageUploadResult>((resolve) => {
        const onGone = () => {
          if (pending?.requestId !== requestId) return;
          settle({ action: 'cancel' });
          try {
            getDialog().hide();
          } catch {
            // ignore
          }
        };
        const onNavigate = (
          _ev: unknown,
          _url: string,
          isInPlace: boolean,
          isMainFrame: boolean,
        ) => {
          if (isMainFrame && !isInPlace) onGone();
        };
        sender.once('destroyed', onGone);
        sender.on('did-start-navigation', onNavigate);

        pending = {
          requestId,
          sender,
          host: request.host || '',
          resolve,
          cleanup: () => {
            if (sender.isDestroyed()) return;
            sender.removeListener('destroyed', onGone);
            sender.removeListener('did-start-navigation', onNavigate);
          },
        };

        getDialog()
          .open(appWindow.win, {
            requestId,
            files: request.files,
            accept: request.accept || '',
            multiple: !!request.multiple,
            host: request.host || '',
          })
          .catch((err: unknown) => {
            console.warn('[image-upload] open dialog failed', err);
            if (pending?.requestId === requestId) {
              settle({ action: 'original' });
            }
          });
      });
    },
  );

  // 弹窗回传处理结果。
  ipcMain.on(
    'image-upload-result',
    (
      _e,
      requestId: number,
      result: ImageUploadResult & { rememberSite?: boolean },
    ) => {
      if (!pending || pending.requestId !== requestId) return;
      const host = pending.host;
      if (result?.rememberSite) addBypassSite(host);
      settle({
        action: result?.action || 'cancel',
        files: result?.files,
      });
    },
  );

  // 弹窗内:把处理结果交给浏览器下载。先落到临时目录,再用来源标签的
  // downloadURL(file://) 走常规 will-download 流程,下载浮层/下载记录照常出现。
  ipcMain.handle(
    'image-upload-download',
    async (_e, files: ImageUploadFile[]): Promise<boolean> => {
      if (!Array.isArray(files) || !files.length) return false;
      const wc =
        pending && !pending.sender.isDestroyed()
          ? pending.sender
          : Application.instance.windows.current?.viewManager.selected?.webContents;
      if (!wc || wc.isDestroyed()) return false;
      const dir = await fsPromises.mkdtemp(join(app.getPath('temp'), 'rainsee-img-'));
      for (const f of files) {
        if (!f?.bytes) continue;
        const name = basename(String(f.name || 'image')).replace(/[\\/:*?"<>|]/g, '_');
        const path = join(dir, name || 'image');
        await fsPromises.writeFile(path, Buffer.from(f.bytes));
        wc.downloadURL(pathToFileURL(path).href);
      }
      // 下载完成(拷贝到下载目录)后临时文件就没用了;延迟清理即可。
      setTimeout(() => {
        fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
      }, 10 * 60 * 1000);
      return true;
    },
  );

  // 弹窗内:打开设置(本次按原图放行)。
  ipcMain.on('image-upload-open-settings', (_e, requestId?: number) => {
    if (pending && (requestId == null || pending.requestId === requestId)) {
      settle({ action: 'original' });
    }
    openSettings();
  });

  // 弹窗内:不再拦截(关总开关,本次按原图放行)。
  ipcMain.on('image-upload-disable', (_e, requestId?: number) => {
    if (pending && (requestId == null || pending.requestId === requestId)) {
      settle({ action: 'original' });
    }
    updateSettings({ imageUploadInterceptEnabled: false });
  });

  // 弹窗被隐藏(Esc / 点外部)但没回传结果:按取消处理。
  ipcMain.on('image-upload-dismissed', (_e, requestId: number) => {
    if (pending?.requestId === requestId) settle({ action: 'cancel' });
  });

  // 设置页。
  ipcMain.handle(
    'set-image-upload-option',
    (_e, key: string, value: unknown) => {
      if (key === 'enabled') {
        updateSettings({ imageUploadInterceptEnabled: !!value });
      } else if (key === 'bypassSites' && Array.isArray(value)) {
        updateSettings({
          imageUploadBypassSites: value
            .filter((x) => typeof x === 'string' && x)
            .map(String),
        });
      } else if (
        key === 'defaultMode' &&
        ['original', 'lossless', 'target', 'crop'].includes(String(value))
      ) {
        updateSettings({ imageUploadDefaultMode: value });
      } else if (key === 'targetKB') {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n < 10) return false;
        updateSettings({ imageUploadTargetKB: Math.min(n, 102400) });
      } else if (key === 'maxEdge') {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n < 0) return false;
        updateSettings({ imageUploadMaxEdge: Math.min(n, 20000) });
      } else {
        return false;
      }
      return true;
    },
  );
};
