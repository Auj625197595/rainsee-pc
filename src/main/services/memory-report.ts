// 运行内存诊断:把 app.getAppMetrics() 的逐进程占用打成一张可读表,并把每个
// 渲染/OOPIF 进程关联到它承载的 webContents(URL + 类型),写进主进程日志
// (userData/logs/main-*.log,logger.ts 已镜像 console)。
//
// 目的:定位「空启动 1.2GB」的真实去向——哪些进程、每个多大、承载什么页面。
// 这是优化前的 ground truth,取代 5 天前的陈旧实测数字。
//
// 触发方式:
//   1. 启动后自动打一份(默认 20s,等待首屏稳定)。
//   2. 随时 IPC `dump-memory-report` 手动再打一份(对比操作前后)。

import { app, ipcMain, webContents } from 'electron';
import type {
  IMemoryProcessItem,
  IMemorySnapshot,
  IMemoryTabReference,
  ITabMemorySnapshot,
  MemoryProcessCategory,
} from '~/interfaces/memory';
import { getWebUIURL } from '~/common/webui-main';
import {getMainTranslator} from '../i18n';
import type {Translator} from '~/common/i18n';

// React Fast Refresh 仅由 renderer webpack 配置注入；主进程不能依赖其运行时。
const toMB = (kb: number) => (kb / 1024).toFixed(1);

const bytesFromKB = (value: number) => Math.max(0, Number(value) || 0) * 1024;

// app.getAppMetrics() 会跨 Chromium 进程汇总数据。单次成本不高，但标签快速
// 划过和内存页刷新可能在很短时间内重复触发，因此用亚秒级缓存合并突发读取。
// 缓存时间足够短，不影响用户感知到的实时性。
let cachedMetrics: Electron.ProcessMetric[] = [];
let cachedMetricsAt = 0;
const readAppMetrics = (maxAge = 750) => {
  const now = Date.now();
  if (cachedMetrics.length > 0 && now - cachedMetricsAt < maxAge) {
    return cachedMetrics;
  }
  cachedMetrics = app.getAppMetrics();
  cachedMetricsAt = now;
  return cachedMetrics;
};

let cachedSnapshot: IMemorySnapshot | null = null;
let cachedSnapshotAt = 0;

const safePid = (wc: Electron.WebContents) => {
  try {
    return wc.isDestroyed() ? 0 : wc.getOSProcessId();
  } catch {
    return 0;
  }
};

const safeTitle = (wc: Electron.WebContents) => {
  try {
    return wc.getTitle() || '';
  } catch {
    return '';
  }
};

const safeUrl = (wc: Electron.WebContents) => {
  try {
    return wc.getURL() || '';
  } catch {
    return '';
  }
};

const getApplication = () => {
  // application.ts 会在启动阶段 import 本模块。这里延迟 require，避免模块初始化时
  // 的循环依赖，同时让内存快照始终读取当前窗口/标签集合。
  return require('../application').Application
    .instance as import('../application').Application;
};

const friendlyInternalPage = (url: string, t: Translator) => {
  const names: Record<string, string> = {
    app: t('mrPgApp'),
    memory: t('mrPgMemory'),
    settings: t('settings'),
    history: t('menuHistory'),
    bookmarks: t('menuBookmarks'),
    downloads: t('dlvTitle'),
    extensions: t('mrPgExtensions'),
    newtab: t('newTab'),
    preview: t('mrPgPreview'),
    search: t('mrPgSearch'),
  };

  for (const key of Object.keys(names)) {
    if (url.includes(`/${key}.html`) || url.includes(`${key}.html`)) {
      return names[key];
    }
  }
  return '';
};

const utilityLabel = (raw: string, t: Translator) => {
  const value = raw.toLowerCase();
  if (value.includes('network')) return t('mrSvcNetwork');
  if (value.includes('audio')) return t('mrSvcAudio');
  if (value.includes('storage')) return t('mrSvcStorage');
  if (value.includes('video') || value.includes('capture'))
    return t('mrSvcMedia');
  if (value.includes('data_decoder') || value.includes('decoder'))
    return t('mrSvcDecoder');
  if (value.includes('proxy')) return t('mrSvcProxy');
  if (value.includes('print')) return t('mrSvcPrint');
  return t('mrSvcOther');
};

const utilityDescription = (raw: string, t: Translator) => {
  const value = raw.toLowerCase();
  if (value.includes('network')) {
    return t('mrDescNetwork');
  }
  if (value.includes('audio')) {
    return t('mrDescAudio');
  }
  if (value.includes('storage')) {
    return t('mrDescStorage');
  }
  if (value.includes('video') || value.includes('capture')) {
    return t('mrDescMedia');
  }
  if (value.includes('data_decoder') || value.includes('decoder')) {
    return t('mrDescDecoder');
  }
  if (value.includes('proxy')) {
    return t('mrDescProxy');
  }
  return t('mrDescUtilityGeneric');
};

interface IContentReference {
  webContentsId: number;
  kind: string;
  label: string;
  url: string;
}

const buildRuntimeReferences = (t: Translator) => {
  const pidToTabs = new Map<number, IMemoryTabReference[]>();
  const tabWebContentsIds = new Set<number>();

  for (const appWindow of getApplication().windows?.list || []) {
    for (const view of appWindow.viewManager?.views?.values() || []) {
      const wc = view.webContents;
      const pid = safePid(wc);
      if (!pid) continue;
      tabWebContentsIds.add(wc.id);
      const tabs = pidToTabs.get(pid) || [];
      tabs.push({
        id: view.id,
        title: view.title || safeTitle(wc) || t('mrUntitledTab'),
        url: view.url || safeUrl(wc),
        selected: appWindow.viewManager.selectedId === view.id,
      });
      pidToTabs.set(pid, tabs);
    }
  }

  const pidToContents = new Map<number, IContentReference[]>();
  for (const wc of webContents.getAllWebContents()) {
    const pid = safePid(wc);
    if (!pid) continue;

    const url = safeUrl(wc);
    const wcType = wc.getType();
    const internalName = friendlyInternalPage(url, t);
    let kind: string = wcType;
    let label = safeTitle(wc) || internalName || wcType;

    if (tabWebContentsIds.has(wc.id)) {
      kind = 'tab';
      label = safeTitle(wc) || internalName || t('mrWebTab');
    } else if (
      wcType === 'backgroundPage' ||
      url.startsWith('chrome-extension://')
    ) {
      kind = 'extension';
      label = safeTitle(wc) || t('mrExtBackground');
    } else if (internalName) {
      kind = 'browser-ui';
      label = internalName;
    }

    const refs = pidToContents.get(pid) || [];
    refs.push({ webContentsId: wc.id, kind, label, url });
    pidToContents.set(pid, refs);
  }

  return { pidToTabs, pidToContents };
};

const processPresentation = (
  metric: Electron.ProcessMetric,
  tabs: IMemoryTabReference[],
  contents: IContentReference[],
  t: Translator,
): {
  category: MemoryProcessCategory;
  name: string;
  description: string;
} => {
  const type = String(metric.type || 'Unknown');
  const rawService = String(
    (metric as any).serviceName || (metric as any).name || '',
  );
  const hasExtension = contents.some((item) => item.kind === 'extension');

  if (type === 'Browser') {
    return {
      category: 'browser',
      name: t('mrNameBrowser'),
      description:
        t('mrDescBrowser'),
    };
  }
  if (type === 'GPU') {
    return {
      category: 'gpu',
      name: t('mrNameGpu'),
      description:
        t('mrDescGpu'),
    };
  }
  if (type === 'Utility') {
    return {
      category: 'utility',
      name: utilityLabel(rawService, t),
      description: utilityDescription(rawService, t),
    };
  }
  if (hasExtension && tabs.length === 0) {
    return {
      category: 'extension',
      name: t('mrNameExtBackground'),
      description: t('mrDescExtBackground'),
    };
  }
  if (type === 'Tab' || type.toLowerCase() === 'renderer') {
    if (tabs.length === 1) {
      return {
        category: 'tab',
        name: tabs[0].title || t('mrNameRenderer'),
        description: t('mrDescRenderer'),
      };
    }
    if (tabs.length > 1) {
      return {
        category: 'tab',
        name: t('mrNameSharedRenderer', {count: tabs.length}),
        description:
          t('mrDescSharedRenderer'),
      };
    }
    const uiNames = contents
      .filter((item) => item.kind === 'browser-ui')
      .map((item) => item.label);
    if (uiNames.length > 0) {
      return {
        category: 'browser',
        name: uiNames[0],
        description:
          t('mrDescBrowserUi'),
      };
    }
    return {
      category: 'other',
      name: t('mrNameSubframe'),
      description:
        t('mrDescSubframe'),
    };
  }
  return {
    category: 'other',
    name: rawService || t('mrNameTypedProcess', {type}),
    description: t('mrDescOtherProcess'),
  };
};

export const buildMemorySnapshot = (): IMemorySnapshot => {
  const metrics = readAppMetrics();
  // 内存页对用户可见,标签/进程名/描述按当前设置语言即时翻译。
  const t = getMainTranslator(
    getApplication().settings?.object?.language,
  );
  const { pidToTabs, pidToContents } = buildRuntimeReferences(t);

  const processes: IMemoryProcessItem[] = metrics.map((metric) => {
    const tabs = pidToTabs.get(metric.pid) || [];
    const contents = pidToContents.get(metric.pid) || [];
    const presentation = processPresentation(metric, tabs, contents, t);
    const serviceName = String(
      (metric as any).serviceName || (metric as any).name || '',
    );
    const memory = metric.memory as any;

    return {
      pid: metric.pid,
      type: String(metric.type || 'Unknown'),
      typeLabel: typeLabel(String(metric.type || 'Unknown')),
      category: presentation.category,
      name: presentation.name,
      description: presentation.description,
      serviceName,
      memoryBytes: bytesFromKB(memory?.workingSetSize),
      privateBytes: bytesFromKB(memory?.privateBytes),
      cpuPercent: Math.max(0, Number(metric.cpu?.percentCPUUsage) || 0),
      tabs,
      contentLabels: contents
        .map((item) => item.label)
        .filter((label, index, all) => !!label && all.indexOf(label) === index),
    };
  });

  processes.sort((a, b) => b.memoryBytes - a.memoryBytes);

  return {
    timestamp: Date.now(),
    totalBytes: processes.reduce((sum, item) => sum + item.memoryBytes, 0),
    totalPrivateBytes: processes.reduce(
      (sum, item) => sum + item.privateBytes,
      0,
    ),
    processCount: processes.length,
    tabProcessCount: processes.filter((item) => item.category === 'tab').length,
    tabCount: Array.from(pidToTabs.values()).reduce(
      (sum, tabs) => sum + tabs.length,
      0,
    ),
    processes,
  };
};

const readMemorySnapshot = () => {
  const now = Date.now();
  // 限制高频 IPC/重复点击最多每秒做一次完整关联扫描。正常页面轮询间隔远大于它。
  if (cachedSnapshot && now - cachedSnapshotAt < 1000) {
    return cachedSnapshot;
  }
  cachedSnapshot = buildMemorySnapshot();
  cachedSnapshotAt = now;
  return cachedSnapshot;
};

export const getTabMemorySnapshot = (tabId: number): ITabMemorySnapshot => {
  const appWindow = (getApplication().windows?.list || []).find((candidate) =>
    candidate.viewManager?.getById(tabId),
  );
  const view = appWindow?.viewManager?.getById(tabId);
  if (!view || view.webContents.isDestroyed()) {
    return {
      available: false,
      pid: 0,
      memoryBytes: 0,
      privateBytes: 0,
      sharedTabCount: 0,
    };
  }

  const pid = safePid(view.webContents);
  const metric = readAppMetrics(1000).find((item) => item.pid === pid);
  if (!pid || !metric) {
    return {
      available: false,
      pid,
      memoryBytes: 0,
      privateBytes: 0,
      sharedTabCount: 0,
    };
  }

  let sharedTabCount = 0;
  for (const candidateWindow of getApplication().windows?.list || []) {
    for (const candidateView of candidateWindow.viewManager?.views?.values() ||
      []) {
      if (safePid(candidateView.webContents) === pid) sharedTabCount += 1;
    }
  }

  const memory = metric.memory as any;
  return {
    available: true,
    pid,
    memoryBytes: bytesFromKB(memory?.workingSetSize),
    privateBytes: bytesFromKB(memory?.privateBytes),
    sharedTabCount,
  };
};

const findPreviewDialog = (senderId?: number) => {
  return getApplication().dialogs?.persistentDialogs?.find(
    (item: any) =>
      item.name === 'preview' &&
      (senderId === undefined || item.webContents?.id === senderId),
  );
};

const openMemoryPanelForPreview = (dialog: any) => {
  const application = getApplication();
  const owner = dialog?.browserWindow
    ? application.windows.fromBrowserWindow(dialog.browserWindow)
    : application.windows.current;
  if (!owner) return;

  dialog?.hide?.();
  owner.viewManager.create({
    url: getWebUIURL('memory'),
    active: true,
  });
};

const isSelectedBrowserView = (webContentsId: number) => {
  return (getApplication().windows?.list || []).some(
    (appWindow) =>
      appWindow.viewManager?.selected?.webContents?.id === webContentsId,
  );
};

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
// 匿名渲染进程(比如网页内嵌的跨域 iframe)。
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
        `[mem]   ${toMB(r.ws).padStart(7)} MB  pid=${String(r.pid).padStart(
          6,
        )}  ${r.type}  ${label}`,
      );
    }
    // 跨域 OOPIF 子帧(那些「无 webContents」匿名渲染进程多半就是它们)。
    const oopif = collectOopifFrames();
    if (oopif.length) {
      lines.push(
        `[mem]   --- 跨域子帧 OOPIF(独立进程,常显示为「无 webContents」)---`,
      );
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
  ipcMain.handle('memory-get-snapshot', (event) => {
    // 渲染端已在 document.hidden 时停轮询；这里再做一层主进程保护。
    // 即使某个平台没有正确更新 BrowserView 的 visibilityState，后台内存页也只会
    // 拿到最近缓存，不触发新的进程枚举。
    if (!isSelectedBrowserView(event.sender.id) && cachedSnapshot) {
      return cachedSnapshot;
    }
    return readMemorySnapshot();
  });
  ipcMain.handle('memory-get-tab', (_event, tabId: number) =>
    getTabMemorySnapshot(tabId),
  );

  // 标签悬浮预览是独立 BrowserView。点击内存行后按 sender 找到预览所属主窗，
  // 再由该窗口新建内存面板标签，避免把 preview 自己导航走。
  ipcMain.on('preview-open-memory-panel', (event) => {
    openMemoryPanelForPreview(findPreviewDialog(event.sender.id));
  });

  // 启动后自动打一份(等待首屏稳定)。setTimeout 不阻塞启动。
  // setTimeout(() => dumpMemoryReport('启动+20s'), 20000);
};
