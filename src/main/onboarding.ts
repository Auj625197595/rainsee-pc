import {app, BrowserWindow, ipcMain, shell} from 'electron';
import {join} from 'path';
import {pathToFileURL} from 'url';
import {existsSync, writeFileSync} from 'fs';

import {getPath} from '~/utils';
import {Application} from './application';

// userData 下的标志文件：存在即表示已完成引导。完全同步读写，可在 onReady 早期判断，
// 不依赖 settings 服务的 async load()。仿 device-info.ts 的 devid 模式。
const ONBOARDING_FLAG = 'onboarding-done';

const isDev = () => process.env.NODE_ENV === 'development';

/** 仅首次启动需要引导（标志文件不存在）。 */
export const isOnboardingNeeded = (): boolean => {
  const p = getPath(ONBOARDING_FLAG);
  return !p || !existsSync(p);
};

const markOnboardingDone = () => {
  const p = getPath(ONBOARDING_FLAG);
  if (!p) return;
  try {
    writeFileSync(p, String(Date.now()));
  } catch (e) {
    console.error('[onboarding] write flag failed', e);
  }
};

/**
 * 显示全屏引导窗，返回 Promise：用户「完成/跳过」或强关时均 resolve。
 * - 完成/跳过（引导页发 onboarding-complete）→ 应用所选设置 + 写标志。
 * - 强关（Alt+F4 等，未发 onboarding-complete）→ 不写标志，下次启动仍显示。
 *
 * 时序：由 application.onReady 在 sessions 创建后、windows.open() 前 await 调用，
 * 故 updateSettings 时 sessions 已就绪（update() 会装配广告拦截/主题等）。
 */
export const showOnboarding = (): Promise<'continue' | 'quit'> => {
  return new Promise<'continue' | 'quit'>((resolve) => {
    let resolved = false;
    let shouldQuit = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve(shouldQuit ? 'quit' : 'continue');
      }
    };

    const win = new BrowserWindow({
      frame: false,
      show: false,
      center: true,
      minWidth: 800,
      minHeight: 600,
      width: 1000,
      height: 680,
      backgroundColor: '#f5f7fd',
      webPreferences: {
        // 独立内存 session:协议弹窗用 iframe 加载外部协议页,需移除其响应里的
        // X-Frame-Options / CSP 才能被嵌套显示;用独立 partition 与主 session 隔离,
        // 不影响正常浏览。
        partition: 'onboarding',
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        webSecurity: false,
        allowRunningInsecureContent: true,
        worldSafeExecuteJavaScript: true,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        enableWebSQL: false,
      },
    });

    try {
      require('@electron/remote/main').enable(win.webContents);
    } catch (e) {
      console.error('[onboarding] enable @electron/remote failed', e);
    }

    const url = isDev()
      ? 'http://localhost:4444/onboarding.html'
      : pathToFileURL(join(app.getAppPath(), 'build', 'onboarding.html')).href;

    // 协议弹窗用 iframe 加载外部协议页,移除响应里的 X-Frame-Options / CSP frame
    // 限制,避免被拒嵌套而白屏。仅作用于引导窗的独立 partition session。
    try {
      win.webContents.session.webRequest.onHeadersReceived(
        {urls: ['<all_urls>']},
        (details, callback) => {
          const headers: Record<string, string | string[]> = {
            ...(details.responseHeaders || {}),
          };
          for (const k of Object.keys(headers)) {
            const lk = k.toLowerCase();
            if (
              lk === 'x-frame-options' ||
              lk === 'content-security-policy' ||
              lk === 'content-security-policy-report-only'
            ) {
              delete headers[k];
            }
          }
          callback({responseHeaders: headers});
        },
      );
    } catch (e) {
      console.error('[onboarding] onHeadersReceived setup failed', e);
    }

    win.loadURL(url);

    win.once('ready-to-show', () => {
      try {
        win.maximize();
        win.show();
      } catch (e) {
        console.error('[onboarding] show failed', e);
      }
    });

    // 协议链接（用户协议/隐私政策）：用系统浏览器打开。
    ipcMain.handle('onboarding-open-external', (_e, target: string) => {
      if (typeof target === 'string') {
        shell.openExternal(target).catch(() => {});
      }
      return undefined;
    });

    // 引导完成/跳过：应用所选设置 + 写标志 + 关窗。
    const onComplete = (_e: Electron.IpcMainEvent, partial: Record<string, unknown>) => {
      try {
        if (partial && typeof partial === 'object') {
          Application.instance.settings.updateSettings(partial as any);
        }
        markOnboardingDone();
      } catch (e) {
        console.error('[onboarding] complete error', e);
      }
      // 关窗会触发下方 'closed' → done()；这里无需重复 resolve。
      try {
        win.close();
      } catch (e) {
        console.error('[onboarding] close failed', e);
        done();
      }
    };
    ipcMain.once('onboarding-complete', onComplete);

    const onExit = () => {
      shouldQuit = true;
      try {
        app.quit();
      } catch (e) {
        console.error('[onboarding] quit failed', e);
        done();
      }
    };
    ipcMain.once('onboarding-exit', onExit);

    // 窗口关闭（完成路径或强关均会到这里）：清理 IPC 监听并放行主流程。
    win.on('closed', () => {
      try {
        ipcMain.removeListener('onboarding-complete', onComplete);
      } catch {}
      try {
        ipcMain.removeListener('onboarding-exit', onExit);
      } catch {}
      try {
        ipcMain.removeHandler('onboarding-open-external');
      } catch {}
      done();
    });
  });
};
