// 运行内存诊断:把 app.getAppMetrics() 的逐进程占用打成一张可读表,并把每个
// 渲染/OOPIF 进程关联到它承载的 webContents(URL + 类型),写进主进程日志
// (userData/logs/main-*.log,logger.ts 已镜像 console)。
//
// 目的:定位「空启动 1.2GB」的真实去向——哪些进程、每个多大、承载什么页面。
// 这是优化前的 ground truth,取代 5 天前的陈旧实测数字。
//
// 触发方式:
//   1. 启动后自动打一份(默认 20s,等首屏稳定 + 弹窗预热跑完)。
//   2. 随时 IPC `dump-memory-report` 手动再打一份(对比操作前后)。

import { app, ipcMain, webContents } from 'electron';

// 注意:dev 构建给所有 src 文件挂了 react-refresh/babel,它会把「首字母大写」的
// 顶层绑定当成 React 组件注入 $RefreshReg$(主进程 bundle 里没有该运行时会崩)。
// 所以本文件所有顶层名一律小写开头。
const toMB = (kb: number) => (kb / 1024).toFixed(1);

// 把进程类型翻译成中文标签,便于快速读表。
const typeLabel = (type: string): string => {
  switch (type) {
    case 'Browser':
      return '主进程';
    case 'GPU':
      return 'GPU';
    case 'Utility':
      return '工具进程';
    case 'Tab':
    case 'renderer':
      return '渲染进程';
    default:
      return type;
  }
};

// pid -> 该进程承载的 webContents 描述(URL + 类型)。一个渲染进程可能承载多个
// frame(OOPIF 独立进程,同源 iframe 共享),这里全列出。
const buildPidToContents = (): Map<number, string[]> => {
  const map = new Map<number, string[]>();
  for (const wc of webContents.getAllWebContents()) {
    let pid = -1;
    try {
      pid = wc.getOSProcessId();
    } catch {
      continue;
    }
    if (!pid) continue;
    let desc = '';
    try {
      const url = wc.getURL() || '(空)';
      desc = `${wc.getType()} ${url.slice(0, 90)}`;
    } catch {
      desc = wc.getType();
    }
    const list = map.get(pid) || [];
    list.push(desc);
    map.set(pid, list);
  }
  return map;
};

// 跨域 iframe(OOPIF)跑在独立渲染进程里,但它没有独立的 webContents(是某个
// webContents 的子帧),故 getAllWebContents 拿不到 → 在进程表里显示「无 webContents」。
// 这里枚举所有 webContents 的子帧树,把跨域子帧的 URL 列出来,用来对号入座那些
// 匿名渲染进程(比如首页里的 pcapp.rainsee.cn)。
const collectOopifFrames = (): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const wc of webContents.getAllWebContents()) {
    let topOrigin = '';
    try {
      topOrigin = new URL(wc.getURL()).origin;
    } catch {
      // 无法解析 top URL 时不过滤,全列
    }
    let frames: any[] = [];
    try {
      frames = (wc as any).mainFrame?.framesInSubtree || [];
    } catch {
      continue;
    }
    for (const f of frames) {
      let url = '';
      let origin = '';
      try {
        url = f.url || '';
        origin = f.origin || (url ? new URL(url).origin : '');
      } catch {
        origin = '';
      }
      if (!url || url === 'about:blank') continue;
      if (origin && origin === topOrigin) continue; // 同源子帧不占独立进程,跳过
      const key = origin || url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${url.slice(0, 90)}  (pid=${(f as any).osProcessId ?? '?'})`);
    }
  }
  return out;
};

export const dumpMemoryReport = (tag = '') => {
  try {
    const metrics = app.getAppMetrics();
    const pidToContents = buildPidToContents();

    let total = 0;
    const rows = metrics
      .map((m) => {
        const ws = m.memory.workingSetSize; // KB
        total += ws;
        return {
          pid: m.pid,
          type: typeLabel(m.type),
          serviceName: (m as any).serviceName || (m as any).name || '',
          ws,
          contents: pidToContents.get(m.pid) || [],
        };
      })
      .sort((a, b) => b.ws - a.ws);

    const lines: string[] = [];
    lines.push(
      `[mem] ===== 内存诊断${tag ? ' ' + tag : ''} 总计 ${toMB(total)} MB / ${
        metrics.length
      } 进程 =====`,
    );
    for (const r of rows) {
      const label =
        r.contents.length > 0
          ? r.contents.join(' | ')
          : r.serviceName || '(无 webContents)';
      lines.push(
        `[mem]   ${toMB(r.ws).padStart(7)} MB  pid=${String(r.pid).padStart(6)}  ${
          r.type
        }  ${label}`,
      );
    }
    // 跨域 OOPIF 子帧(那些「无 webContents」匿名渲染进程多半就是它们)。
    const oopif = collectOopifFrames();
    if (oopif.length) {
      lines.push(`[mem]   --- 跨域子帧 OOPIF(独立进程,常显示为「无 webContents」)---`);
      for (const f of oopif) lines.push(`[mem]     子帧 ${f}`);
    }
    // 逐行打印,logger 会镜像到文件。
    for (const l of lines) console.log(l);
    return { totalMB: Number(toMB(total)), processCount: metrics.length };
  } catch (e) {
    console.log('[mem] dumpMemoryReport failed:', e);
    return null;
  }
};

export const setupMemoryReport = () => {
  // 手动触发通道:renderer / 调试台可随时 invoke。
  ipcMain.handle('dump-memory-report', () => dumpMemoryReport('手动'));

  // 启动后自动打一份(等首屏 + 弹窗预热稳定)。setTimeout 不阻塞启动。
  setTimeout(() => dumpMemoryReport('启动+20s'), 20000);
};
