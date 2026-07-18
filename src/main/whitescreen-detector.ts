// 主窗口白屏/卡死检测 + 恢复覆盖层。
//
// 动机:线上出现过打开重负载页面(linux.do + 多扩展 + adblock)后整窗白屏、
// 地址栏消失,只能手动关闭应用的情况。日志里既无 render-process-gone 也无
// child-process-gone,说明现有体系对「主 UI 渲染进程卡死(unresponsive)」
// 这类故障零可见度。本模块专门处理:
//
//   1) 监听主窗口 webContents 的 render-process-gone(渲染进程崩)与
//      unresponsive(UI 卡死,超 12s 才确认,避免短时卡顿误报)。
//   2) 任一触发即弹出一个【独立 BrowserWindow】覆盖层(不依赖已死/已卡的
//      主渲染进程,所以一定能显示),内含诊断日志 + 「复制日志」「重启浏览器」
//      「打开日志目录」。
//
// 「重启浏览器」走 app.relaunch() + app.exit(0):整窗重启,启动时按
// startupBehavior='continue' 还原标签页。app.exit 直接终结进程,即便主 UI
// 卡死也能可靠退出。

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, statSync } from 'fs';
import { getLogDir, getLogPath } from './logger';
import type { AppWindow } from './windows/app';

// unresponsive 确认窗口:Electron 的 unresponsive 在事件循环阻塞时较快触发,
// 这里再等 N 秒,期间收到 responsive/did-finish-load(说明已恢复)就取消,
// 避免短时重负载卡顿误判为白屏。
const UNRESPONSIVE_TIMEOUT_MS = 12000;

// 日志尾部截取量:全量日志可能上百 KB,页面上只展示末尾(最近的崩溃信息在尾部)。
const LOG_TAIL_BYTES = 60 * 1024;

// 每个主窗口是否已弹覆盖层 + 待确认的 unresponsive 定时器。
const overlayByWindow = new WeakMap<AppWindow, BrowserWindow | null>();
const unresponsiveTimers = new WeakMap<AppWindow, NodeJS.Timeout>();

// 最近一次触发的现场,供全局 IPC 处理器(覆盖层页面调用)读取。
let lastTriggerAppWindow: AppWindow | null = null;
let lastReason = '';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

const timestamp = () => {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
      d.getMilliseconds(),
      3,
    )}`
  );
};

// 取日志文件尾部。返回 utf8 文本 + 总字节数 + 是否截断。
const readLogTail = (): { text: string; bytes: number; truncated: boolean } => {
  const path = getLogPath();
  if (!path) return { text: '(日志路径未知)', bytes: 0, truncated: false };
  let buf: Buffer;
  let total = 0;
  try {
    total = statSync(path).size;
    buf = readFileSync(path);
  } catch {
    return { text: '(无法读取日志文件)', bytes: 0, truncated: false };
  }
  if (!buf || buf.length === 0) return { text: '(日志为空)', bytes: 0, truncated: false };

  let truncated = false;
  let slice = buf;
  if (buf.length > LOG_TAIL_BYTES) {
    truncated = true;
    slice = buf.subarray(buf.length - LOG_TAIL_BYTES);
    // 从第一个换行处开始,避免头部半行乱码。
    const nl = slice.indexOf(0x0a);
    if (nl > 0 && nl < slice.length - 1) slice = slice.subarray(nl + 1);
  }
  return { text: slice.toString('utf8'), bytes: total, truncated };
};

// 合成现场头部:触发时间/原因/版本/环境/主窗口URL。复制给作者时能自解释。
const buildHeader = (reason: string): string => {
  const lines: string[] = [];
  lines.push('===== 雨见浏览器 白屏/卡死诊断 =====');
  lines.push(`触发时间: ${timestamp()}`);
  lines.push(`触发原因: ${reason || '(未知)'}`);
  try {
    lines.push(`应用: ${app.getName()} v${app.getVersion()}`);
  } catch {}
  try {
    lines.push(
      `环境: Electron ${process.versions.electron} / Chrome ${process.versions.chrome} / Node ${process.versions.node}`,
    );
    lines.push(`平台: ${process.platform} ${process.arch}`);
  } catch {}
  try {
    const w = lastTriggerAppWindow;
    if (w && !w.win.isDestroyed()) {
      lines.push(`主窗口URL: ${w.webContents.getURL()}`);
    }
  } catch {}
  lines.push(`日志路径: ${getLogPath()}`);
  lines.push('');
  return lines.join('\n');
};

// 创建覆盖层窗口。失败返回 null。
const createOverlay = (appWindow: AppWindow): BrowserWindow | null => {
  try {
    const parent = appWindow.win;
    const overlay = new BrowserWindow({
      parent,
      title: '浏览器白屏恢复',
      width: 680,
      height: 540,
      minWidth: 480,
      minHeight: 360,
      resizable: true,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#1c1c1c',
      // 卡死/崩溃恢复对话框:置顶确保用户一定能看到并操作。
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const url = pathToFileURL(
      join(__dirname, '..', 'static', 'pages', 'crash-reporter.html'),
    ).href;
    overlay.loadURL(url);

    // 父窗口居中弹出。
    overlay.once('ready-to-show', () => {
      try {
        const pb = parent.getBounds();
        const ob = overlay.getBounds();
        const x = Math.round(pb.x + (pb.width - ob.width) / 2);
        const y = Math.round(pb.y + (pb.height - ob.height) / 2);
        overlay.setPosition(x, y);
      } catch {
        // 居中失败由系统默认位置兜底。
      }
      overlay.show();
      overlay.focus();
    });

    return overlay;
  } catch (e) {
    console.error('[whitescreen] overlay 创建失败', e);
    return null;
  }
};

const trigger = (appWindow: AppWindow, reason: string) => {
  // 每个窗口同一时刻只弹一个覆盖层。
  if (overlayByWindow.get(appWindow)) return;
  // 窗口已销毁(用户已关)则不打扰。
  if (appWindow.win.isDestroyed()) return;

  console.error(`[whitescreen] 触发恢复覆盖层: ${reason}`);
  lastTriggerAppWindow = appWindow;
  lastReason = reason;

  const overlay = createOverlay(appWindow);
  if (!overlay) return;
  overlayByWindow.set(appWindow, overlay);
  overlay.on('closed', () => {
    overlayByWindow.set(appWindow, null);
  });
};

const clearUnresponsiveTimer = (appWindow: AppWindow) => {
  const t = unresponsiveTimers.get(appWindow);
  if (t) {
    clearTimeout(t);
    unresponsiveTimers.delete(appWindow);
  }
};

// IPC 只注册一次(模块单次求值)。覆盖层页面通过 nodeIntegration 直连。
let ipcReady = false;
const ensureIpc = () => {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.handle('crash-reporter-get-log', () => {
    const tail = readLogTail();
    const note = tail.truncated
      ? '(…日志已截断,仅显示最后 60KB;完整日志点"打开日志目录")\n\n'
      : '';
    return {
      text: buildHeader(lastReason) + note + tail.text,
      bytes: tail.bytes,
      truncated: tail.truncated,
      reason: lastReason,
    };
  });

  ipcMain.on('crash-reporter-restart', () => {
    // app.exit 直接终结,不触发 before-quit/will-quit,即便主 UI 卡死也能退出。
    try {
      app.relaunch();
    } catch {
      // relaunch 失败仍尝试退出。
    }
    app.exit(0);
  });

  ipcMain.on('crash-reporter-open-dir', async () => {
    try {
      await shell.openPath(getLogDir());
    } catch {
      // 忽略。
    }
  });
};

// 在主窗口上挂检测。仅 AppWindow(主 UI 窗口)调用,不含 popup/dialog。
export const attachWhiteScreenDetector = (appWindow: AppWindow) => {
  ensureIpc();

  const wc = appWindow.webContents;

  // 渲染进程崩溃(OOM/(crashed)/killed)→ 立即弹。
  wc.on('render-process-gone', (_e, details: any) => {
    trigger(
      appWindow,
      `render-process-gone (reason=${details?.reason || 'unknown'}, exitCode=${details?.exitCode ?? '?'})`,
    );
  });

  // UI 卡死:启动 12s 确认定时器;期间恢复则取消。
  wc.on('unresponsive', () => {
    if (unresponsiveTimers.has(appWindow)) return;
    const timer = setTimeout(() => {
      unresponsiveTimers.delete(appWindow);
      trigger(
        appWindow,
        `unresponsive (主 UI 卡死超过 ${UNRESPONSIVE_TIMEOUT_MS / 1000}s)`,
      );
    }, UNRESPONSIVE_TIMEOUT_MS);
    unresponsiveTimers.set(appWindow, timer);
  });

  wc.on('responsive', () => {
    clearUnresponsiveTimer(appWindow);
  });

  // 重载/导航完成说明 UI 已重新绘制,取消待触发的卡死判定。
  wc.on('did-finish-load', () => {
    clearUnresponsiveTimer(appWindow);
  });
};
