// 主进程文件日志:把 console / 崩溃 / 渲染进程错误统一写到本地文件,
// 供打包版排查问题(打包后 console 不可见,过去每个 bug 都得手搓探针定位)。
//
// 日志位置:userData/logs/main-<时间戳>.log。userData 与 settings.json 同目录
// (开发态 = 项目/data,打包态 = 可执行文件同级/data;装到 Program Files 不可写时
// bootstrap-paths 已让 userData 回退到系统 AppData,这里同样可写)。
// 每次启动新建一份,按修改时间只保留最新 MAX_LOG_FILES 份。
//
// 通过覆盖 console.{log,info,warn,error} 把全量输出镜像到文件,
// 现有 console.log / tlog 调用无需任何改动即自动落盘。
// 该模块在被 import 时自初始化,需在 ./application 之前 import,以便捕获
// Application 构造(Settings 等)期间的异常。

import { app, crashReporter, ipcMain } from 'electron';
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  appendFileSync,
} from 'fs';
import { basename, join } from 'path';

// 日志保留份数(按修改时间最新的 N 份,超出自动删除)。
const MAX_LOG_FILES = 30;

let stream: ReturnType<typeof createWriteStream> | null = null;
let logFilePath = '';
let terminalConsoleAvailable = true;

const MAX_RENDERER_DIAGNOSTICS = 32;
const rendererDiagnostics = new Map<number, string[]>();

const recordRendererDiagnostic = (webContentsId: number, detail: string) => {
  const entries = rendererDiagnostics.get(webContentsId) || [];
  entries.push(`[${timestamp()}] ${detail.replace(/[\r\n]+/g, ' ').slice(0, 800)}`);
  if (entries.length > MAX_RENDERER_DIAGNOSTICS) {
    entries.splice(0, entries.length - MAX_RENDERER_DIAGNOSTICS);
  }
  rendererDiagnostics.set(webContentsId, entries);
};

const formatExitCode = (value: unknown) => {
  const exitCode = Number(value);
  if (!Number.isInteger(exitCode)) return String(value ?? '?');
  return `${exitCode} (0x${(exitCode >>> 0).toString(16).toUpperCase()})`;
};

// 保留原始 console,镜像的同时仍输出到终端(开发态可见)。
const origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const writeToOrigConsole = (
  level: keyof typeof origConsole,
  args: any[],
) => {
  if (!terminalConsoleAvailable) return;
  try {
    origConsole[level](...args);
  } catch (err: any) {
    // 安装器拉起的首个 GUI 进程可能继承到已关闭的 stdout/stderr。
    // 一旦命中 EPIPE，后续只保留文件日志，避免 console.* -> EPIPE -> uncaughtException 递归。
    if (err?.code === 'EPIPE') {
      terminalConsoleAvailable = false;
      writeSync(
        `[${timestamp()}] [LOGGER] original console disabled after EPIPE on ${level}\n`,
      );
      return;
    }
    throw err;
  }
};

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

const stringify = (args: any[]): string =>
  args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');

const write = (level: string, args: any[]) => {
  if (!stream) return;
  const line = `[${timestamp()}] [${level}] ${stringify(args)}\n`;
  try {
    stream.write(line);
  } catch {
    // 写入异常绝不拖垮主进程
  }
};

// 进程退出前的兜底同步写,防止 WriteStream 缓冲未刷盘丢失崩溃信息。
const writeSync = (line: string) => {
  if (!logFilePath) return;
  try {
    appendFileSync(logFilePath, line);
  } catch {
    // 尽力而为
  }
};

const recentCrashDumps = (): string[] => {
  try {
    const crashDir = app.getPath('crashDumps');
    return readdirSync(crashDir)
      .filter((name) => /\.(dmp|mdmp)$/i.test(name))
      .map((name) => ({ name, time: statSync(join(crashDir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5)
      .map(({ name }) => basename(name));
  } catch {
    return [];
  }
};

const prune = (dir: string) => {
  try {
    const entries = readdirSync(dir)
      .filter((f) => /^main-.*\.log$/.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of entries.slice(MAX_LOG_FILES)) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        // 忽略单个删除失败
      }
    }
  } catch {
    // 忽略
  }
};

// 归一化 Electron 不同版本的 console-message 参数:
// 旧版 (event, level, message, line, sourceId)
// 30+  (event, details{level,message,sourceId,lineNumber,...})
const normalizeConsoleMessage = (a: any[]) => {
  if (a.length >= 2 && typeof a[1] === 'object' && a[1] !== null) {
    const d = a[1];
    return { level: d.level, message: d.message, line: d.lineNumber, sourceId: d.sourceId };
  }
  return { level: a[1], message: a[2], line: a[3], sourceId: a[4] };
};

export const getLogDir = () => join(app.getPath('userData'), 'logs');
export const getLogPath = () => logFilePath;

export const initLogger = () => {
  if (stream) return;

  // 启用 Crashpad:主进程原生崩溃(SIGSEGV/SIGABRT/OOM)不会触发任何 JS 回调,
  // 只能靠 minidump 抓栈。此前未启用,故“整窗秒退”无任何痕迹可查。本地落盘,
  // 不上传。必须早于 app ready 调用(initLogger 在主入口最先 import,满足该约束)。
  try {
    crashReporter.start({
      submitURL: '',
      uploadToServer: false,
      compress: true,
    });
  } catch {
    // 已启动或不可用则忽略(打包版 fuse 可能禁用)。
  }

  let dir: string;
  try {
    dir = getLogDir();
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    // userData 不可写(异常部署)时退回系统临时目录,保证总能落盘。
    try {
      dir = join(app.getPath('temp'), `${app.name || 'rainsee-pc'}-logs`);
      mkdirSync(dir, { recursive: true });
      origConsole.warn('[logger] userData 不可写,日志改写至临时目录:', dir, e);
    } catch {
      return; // 实在写不了就放弃,不影响应用启动
    }
  }

  prune(dir);

  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  logFilePath = join(dir, `main-${stamp}.log`);

  try {
    stream = createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    return;
  }

  // 主进程 console 全量镜像到文件(现有调用点零改动)。
  console.log = (...args: any[]) => {
    writeToOrigConsole('log', args);
    write('log', args);
  };
  console.info = (...args: any[]) => {
    writeToOrigConsole('info', args);
    write('info', args);
  };
  console.warn = (...args: any[]) => {
    writeToOrigConsole('warn', args);
    write('warn', args);
  };
  console.error = (...args: any[]) => {
    writeToOrigConsole('error', args);
    write('error', args);
  };

  ipcMain.on('renderer-diagnostic', (event: any, payload: any) => {
    const phase = typeof payload?.phase === 'string' ? payload.phase.slice(0, 80) : 'unknown';
    const detail = typeof payload?.detail === 'string' ? payload.detail.slice(0, 400) : '';
    const url = typeof payload?.url === 'string' ? payload.url.slice(0, 600) : '';
    const readyState = typeof payload?.readyState === 'string' ? payload.readyState : '';
    const visibility = typeof payload?.visibility === 'string' ? payload.visibility : '';
    recordRendererDiagnostic(
      event.sender.id,
      `renderer ${phase} url=${url} readyState=${readyState} visibility=${visibility} detail=${detail}`,
    );
  });

  // 崩溃信息同步落盘,防止缓冲丢失。
  process.on('uncaughtException', (err: any) => {
    write('FATAL', [err?.stack || err]);
    writeSync(`[${timestamp()}] [FATAL] ${err?.stack || err}\n`);
  });
  process.on('unhandledRejection', (reason: any) => {
    write('PROMISE', [reason?.stack || reason]);
  });
  process.on('exit', (code) => {
    // `exit` also observes direct app.exit() paths that skip before-quit.
    // It cannot run after a native main-process crash; Crashpad minidumps and
    // the lack of this marker then distinguish that case in a reproduction.
    writeSync(`[${timestamp()}] [EXIT] process exit code=${code}\n`);
  });

  // 关键点:整窗“秒退”类故障排查。此前日志在崩溃处戛然而止、既无 [FATAL] 也无
  // render-process-gone,说明主进程被原生信号(SIGSEGV/SIGABRT/OOM)直接干掉,
  // 异步 WriteStream 缓冲来不及刷盘。这里把所有“进程级终结”事件改成同步落盘,
  // 并捕获退出调用栈,以区分:(a)GPU/渲染进程原生崩溃 (b)主进程原生崩溃 (c)JS 主动退出。
  app.on('child-process-gone', (_e: any, details: any) => {
    // details.type: GPU / Utility / Renderer / Zygote / ...; reason: oom/crashed/killed/...
    // GPU 进程崩溃是“整个浏览器突然消失”的常见根因。
    try {
      writeSync(
        `[${timestamp()}] [PROC-GONE] child-process-gone type=${details?.type} ` +
          `reason=${details?.reason} exitCode=${details?.exitCode} name=${details?.name || ''}\n`,
      );
    } catch {
      // 忽略
    }
  });
  app.on('before-quit', (e: any) => {
    // 用 new Error().stack 抓出谁触发了退出(JS 主动 app.quit/close 会在此暴露调用栈)。
    let stack = '';
    try {
      stack = new Error('quit-trace').stack || '';
    } catch {
      stack = '';
    }
    try {
      writeSync(`[${timestamp()}] [QUIT] before-quit exitCode=${(e as any)?.exitCode}\n${stack}\n`);
    } catch {
      // 忽略
    }
  });
  app.on('will-quit', () => {
    try {
      writeSync(`[${timestamp()}] [QUIT] will-quit\n`);
    } catch {
      // 忽略
    }
  });

  // 渲染进程:加载失败 / 进程崩溃 / console warn+error 转发到主日志。
  app.on('web-contents-created', (_e: any, wc: any) => {
    try {
      const webContentsId = Number(wc.id);
      const describeProcess = () => {
        let osProcessId = '?';
        let frameProcessId = '?';
        try {
          osProcessId = wc.getOSProcessId();
        } catch {}
        try {
          frameProcessId = wc.mainFrame?.processId ?? '?';
        } catch {}
        return `wc=${webContentsId} type=${wc.getType()} osPid=${osProcessId} framePid=${frameProcessId}`;
      };
      recordRendererDiagnostic(webContentsId, `created ${describeProcess()}`);
      wc.on('did-start-navigation', (_ev: any, url: string, isInPlace: boolean, isMainFrame: boolean) => {
        if (isMainFrame) {
          recordRendererDiagnostic(
            webContentsId,
            `did-start-navigation url=${url} inPlace=${Boolean(isInPlace)}`,
          );
        }
      });
      wc.on('did-navigate', (_ev: any, url: string) => {
        recordRendererDiagnostic(webContentsId, `did-navigate url=${url}`);
      });
      wc.on('dom-ready', () => {
        recordRendererDiagnostic(webContentsId, `dom-ready ${describeProcess()}`);
      });
      wc.on('did-finish-load', () => {
        recordRendererDiagnostic(webContentsId, `did-finish-load ${describeProcess()}`);
      });
      wc.on('did-fail-load', (_ev: any, code: number, desc: string, url: string) => {
        recordRendererDiagnostic(webContentsId, `did-fail-load code=${code} desc=${desc} url=${url}`);
        write('RENDERER', [`did-fail-load code=${code} desc=${desc} url=${url}`]);
      });
      wc.on('render-process-gone', (_ev: any, details: any) => {
        // 同步落盘:若紧接着主进程也崩溃,异步 write 会丢失这条关键信息。
        let url = '';
        try {
          url = wc.getURL();
        } catch {
          // 忽略
        }
        const diagnosticTrail = rendererDiagnostics.get(webContentsId) || [];
        const exitCode = formatExitCode(details?.exitCode);
        try {
          writeSync(
            `[${timestamp()}] [PROC-GONE] render-process-gone ${describeProcess()} url=${url} ` +
              `reason=${details?.reason} exitCode=${exitCode}\n` +
              `[${timestamp()}] [RENDERER-TRAIL] wc=${webContentsId} ${JSON.stringify(diagnosticTrail)}\n`,
          );
        } catch {
          // 忽略
        }
        write('RENDERER', [
          `render-process-gone ${describeProcess()} reason=${details?.reason} exitCode=${exitCode}`,
        ]);
      });
      wc.on('console-message', (...a: any[]) => {
        // Electron level: 0 verbose / 1 info / 2 warning / 3 error
        const { level, message, line, sourceId } = normalizeConsoleMessage(a);
        if (typeof level !== 'number' || level < 2) return;
        // 扩展页另有专门处理(index.ts 的 web-contents-created),这里跳过避免重复。
        if (sourceId && sourceId.startsWith('chrome-extension://')) return;
        let url = '';
        try {
          url = wc.getURL();
        } catch {
          // 忽略
        }
        recordRendererDiagnostic(
          webContentsId,
          `console-${level >= 3 ? 'error' : 'warn'} ${message} (${sourceId}:${line})`,
        );
        write(level >= 3 ? 'RENDERER-ERR' : 'RENDERER-WARN', [
          `${message} (${url} ${sourceId}:${line})`,
        ]);
      });
      wc.once('destroyed', () => {
        recordRendererDiagnostic(webContentsId, 'destroyed');
        const cleanup = setTimeout(() => rendererDiagnostics.delete(webContentsId), 60_000);
        cleanup.unref?.();
      });
    } catch {
      // 忽略单个 webContents 挂载失败
    }
  });

  // 启动横幅:排查时第一眼即可定位环境与日志路径。
  write('INFO', ['================ main log start ================']);
  write('INFO', [`app=${app.name} version=${app.getVersion()}`]);
  write('INFO', [
    `electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}`,
  ]);
  write('INFO', [
    `platform=${process.platform} ${process.arch}  NODE_ENV=${process.env.NODE_ENV || '(unset)'}`,
  ]);
  write('INFO', [`userData=${app.getPath('userData')}`]);
  write('INFO', [`logFile=${logFilePath}`]);
  try {
    write('INFO', [`crashDumps=${app.getPath('crashDumps')}`]);
    write('INFO', [`recentCrashDumps=${JSON.stringify(recentCrashDumps())}`]);
  } catch {
    // Electron may reject crashDumps before a platform-specific crash handler
    // is available. The main log remains useful in that case.
  }
  writeToOrigConsole('log', [`[logger] writing to ${logFilePath}`]);
};

// import 时自初始化(需在 ./application 之前 import)。
initLogger();
