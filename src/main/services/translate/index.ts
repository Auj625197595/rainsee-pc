import {app} from 'electron';
import {readFileSync} from 'fs';
import {join} from 'path';

import {executeInTopPage, execInPagePreferMainFrame} from '../../utils/execute-in-top-page';
import {TranslateEngine, chunkTexts} from './engine';
import {getActiveEngine} from './registry';

// 翻译引擎调度层(引擎无关)。
//  - runTranslate:整页翻译。注入引导 static/scripts/ms-translate.js → collect 取
//    [{id,text}] → 主进程分批 engine.translateBatch → apply 逐批回填。引导的 collect/
//    apply/revert 不随引擎变化,只有 engine.translateBatch 随引擎变。
//  - translateText:划词单句。复用当前引擎的 translateBatch([text])。
//  - 主进程为唯一可信源:网页无 ipcRenderer,不向任意网页暴露 IPC;executeJavaScript +
//    改写 nodeValue 不受 CSP 约束(原云端 Google 组件因远程 <script> 被 CSP 拦截而废弃)。

let cachedBootstrap = '';

// 整页翻译缓存只驻留本次应用进程。键中包含页面 URL、引擎配置标识、目标语言及原文，
// 因此“显示原文”后再次翻译能直接回填，同时不会把其他页面或其他翻译引擎的译文混用。
// 用 Map 的插入顺序实现 LRU，限制总量以避免长期浏览导致内存无界增长。
const PAGE_TRANSLATION_CACHE_LIMIT = 10000;
const pageTranslationCache = new Map<string, string>();

// WebContents.executeJavaScript 没有可用的取消 API。超时后底层调用仍可能继续持有
// 页面上下文，因此同一个页面同一时间只允许一个翻译脚本执行，避免超时重试堆积。
const pageExecBusy = new WeakSet<object>();
const pageExecState = new WeakMap<object, {sessionId: number; label: string; startedAt: number}>();
let translateSessionSeq = 0;

type PageTranslateStats = Record<string, number | boolean>;

const mb = (bytes: number | undefined) =>
  typeof bytes === 'number' ? Math.round((bytes / 1024 / 1024) * 10) / 10 : -1;

const kbToMb = (kilobytes: number | undefined) =>
  typeof kilobytes === 'number' ? Math.round((kilobytes / 1024) * 10) / 10 : -1;

const logTranslationMemory = (
  wc: Electron.WebContents,
  sessionId: number,
  stage: string,
  pageStats?: PageTranslateStats | null,
) => {
  const main = process.memoryUsage();
  let rendererPid = 0;
  let rendererMemory: any = null;
  try {
    rendererPid = (wc as any).getOSProcessId?.() || 0;
    const metric = (app.getAppMetrics() as any[]).find((item) => item?.pid === rendererPid);
    rendererMemory = metric?.memory || null;
  } catch {}
  console.log(
    `[translate-mem] session=${sessionId} stage=${stage}` +
    ` mainRssMb=${mb(main.rss)} mainHeapUsedMb=${mb(main.heapUsed)}` +
    ` mainExternalMb=${mb(main.external)} rendererPid=${rendererPid}` +
    ` rendererWorkingSetMb=${kbToMb(rendererMemory?.workingSetSize)}` +
    ` rendererPrivateMb=${kbToMb(rendererMemory?.privateBytes)}` +
    ` cacheSize=${pageTranslationCache.size}` +
    (pageStats ? ` page=${JSON.stringify(pageStats)}` : ''),
  );
};

const parsePageCollection = (
  raw: unknown,
): {items: Array<{id: number; text: string}>; stats: PageTranslateStats | null} => {
  const parsed = JSON.parse(String(raw || ''));
  if (Array.isArray(parsed)) return {items: parsed, stats: null};
  return {
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    stats: parsed?.stats && typeof parsed.stats === 'object' ? parsed.stats : null,
  };
};

const COLLECT_WITH_STATS_CODE = `(function(){var t=window.__rainseeTranslate;if(!t||!t.collect)return '';var items=[];var stats=null;try{items=JSON.parse(t.collect()||'[]');}catch(e){}try{stats=t.stats?t.stats():null;}catch(e){}return JSON.stringify({items:items,stats:stats});})()`;
const COLLECT_NEW_WITH_STATS_CODE = `(function(){var t=window.__rainseeTranslate;if(!t||!t.collectNew)return '';var items=[];var stats=null;try{items=JSON.parse(t.collectNew()||'[]');}catch(e){}try{stats=t.stats?t.stats():null;}catch(e){}return JSON.stringify({items:items,stats:stats});})()`;

const getPageCacheKey = (
  engine: TranslateEngine,
  target: string,
  pageUrl: string,
  text: string,
) => JSON.stringify([engine.cacheKey(), target, pageUrl, text]);

const getPageTranslation = (key: string): string | undefined => {
  const value = pageTranslationCache.get(key);
  if (value === undefined) return undefined;
  // 命中时移到末尾，保留最近使用的译文。
  pageTranslationCache.delete(key);
  pageTranslationCache.set(key, value);
  return value;
};

const cachePageTranslation = (key: string, translation: string) => {
  pageTranslationCache.delete(key);
  pageTranslationCache.set(key, translation);
  while (pageTranslationCache.size > PAGE_TRANSLATION_CACHE_LIMIT) {
    const oldest = pageTranslationCache.keys().next().value;
    if (oldest === undefined) return;
    pageTranslationCache.delete(oldest);
  }
};

export const getMsTranslateBootstrap = () => {
  if (cachedBootstrap) return cachedBootstrap;
  const scriptPath = join(app.getAppPath(), 'static', 'scripts', 'ms-translate.js');
  try {
    cachedBootstrap = readFileSync(scriptPath, 'utf8');
  } catch (error) {
    console.log('[translate] !! failed to read bootstrap', scriptPath, error);
    return '';
  }
  return cachedBootstrap;
};

// ---- 整页驱动 ----
export const runTranslate = async (
  engine: TranslateEngine,
  wc: Electron.WebContents,
  target: string,
  isCancelled: () => boolean,
  signal?: AbortSignal,
): Promise<{ok: boolean; count: number}> => {
  if (!wc || wc.isDestroyed()) {
    console.log('[translate] runTranslate ABORT: wc destroyed');
    return {ok: false, count: 0};
  }
  const bootstrap = getMsTranslateBootstrap();
  if (!bootstrap) {
    console.log('[translate] runTranslate ABORT: bootstrap empty (ms-translate.js 读不到)');
    return {ok: false, count: 0};
  }
  const sessionId = ++translateSessionSeq;
  console.log(`[translate-diag] session=${sessionId} stage=start engine=${engine.id} target=${target} mapped=${engine.mapLang(target)}`);
  logTranslationMemory(wc, sessionId, 'start');
  let pageUrl = '';
  try { pageUrl = wc.getURL(); } catch {}

  // exec:导航感知 + 优先 mainFrame。
  //  ① webContents.executeJavaScript 在部分页面(chrome-extension 沙箱 / 某些 SPA 如 zhso.org)
  //     会挂死(memory 已记,手势注入也为此用 mainFrame)。故优先 wc.mainFrame.executeJavaScript,
  //     失败再退 executeInTopPage(webContents 级)。
  //  ② 主帧导航中途 Promise 会悬空,用 did-start-navigation + 6s 超时双重兜底:任一触发即放弃
  //     本次 exec(返回 undefined),由 view.ts did-finish-load 的 re-drive 兜底重试。
  let pageNavigationAborted = false;
  const exec = async (code: string, label = ''): Promise<any> => {
    if (wc.isDestroyed() || isCancelled() || pageNavigationAborted) {
      console.log(`[translate] exec early-return(${label}) destroyed=${wc.isDestroyed()} cancelled=${isCancelled()} navigation=${pageNavigationAborted}`);
      return undefined;
    }
    const waitDeadline = Date.now() + 6000;
    while (pageExecBusy.has(wc as object)) {
      if (wc.isDestroyed() || isCancelled() || pageNavigationAborted) return undefined;
      if (Date.now() >= waitDeadline) {
        const owner = pageExecState.get(wc as object);
        console.log(
          `[translate-diag] session=${sessionId} stage=exec-busy-timeout label=${label}` +
          ` ownerSession=${owner?.sessionId ?? -1} ownerLabel=${owner?.label || ''}` +
          ` ownerAgeMs=${owner ? Date.now() - owner.startedAt : -1}`,
        );
        logTranslationMemory(wc, sessionId, `exec-busy-timeout:${label}`);
        return undefined;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    pageExecBusy.add(wc as object);
    const execStartedAt = Date.now();
    pageExecState.set(wc as object, {sessionId, label, startedAt: execStartedAt});
    const run = async (): Promise<any> => {
      const mainFrame = (wc as any).mainFrame;
      if (mainFrame && typeof mainFrame.executeJavaScript === 'function') {
        try {
          return await mainFrame.executeJavaScript(code, true);
        } catch (e) {
          console.log(`[translate] exec mainFrame(${label}) 抛错,回退 executeInTopPage`, String((e as Error)?.message || e));
        }
      }
      return executeInTopPage(wc, code, true);
    };
    let cleanup: (() => void) | null = null;
    let raceTimedOut = false;
    const abort = new Promise<undefined>((resolve) => {
      const onNav = (_event: unknown, _url: string, _isInPlace: boolean, isMainFrame: boolean) => {
        if (!isMainFrame) return;
        pageNavigationAborted = true;
        console.log(`[translate-diag] session=${sessionId} stage=exec-navigation-abort label=${label} ageMs=${Date.now() - execStartedAt}`);
        logTranslationMemory(wc, sessionId, `exec-navigation-abort:${label}`);
        resolve(undefined);
      };
      const timer = setTimeout(() => {
        raceTimedOut = true;
        console.log(`[translate-diag] session=${sessionId} stage=exec-timeout label=${label} ageMs=${Date.now() - execStartedAt}`);
        logTranslationMemory(wc, sessionId, `exec-timeout:${label}`);
        resolve(undefined);
      }, 6000);
      cleanup = () => {
        clearTimeout(timer);
        try { wc.removeListener('did-start-navigation', onNav); } catch {}
      };
      try { wc.once('did-start-navigation', onNav); } catch {}
    });
    // race 超时只结束本次等待，不会取消 Electron 内部的执行。只有底层 Promise
    // 真正 settle 后才释放 busy 标记，防止下一轮继续制造悬空 executeJavaScript。
    const execution = run().then(
      (result) => {
        const durationMs = Date.now() - execStartedAt;
        pageExecBusy.delete(wc as object);
        pageExecState.delete(wc as object);
        if (raceTimedOut || durationMs >= 1000) {
          console.log(`[translate-diag] session=${sessionId} stage=exec-settled label=${label} durationMs=${durationMs} late=${raceTimedOut}`);
        }
        return result;
      },
      (error) => {
        const durationMs = Date.now() - execStartedAt;
        pageExecBusy.delete(wc as object);
        pageExecState.delete(wc as object);
        console.log(`[translate-diag] session=${sessionId} stage=exec-rejected label=${label} durationMs=${durationMs} late=${raceTimedOut}`);
        throw error;
      },
    );
    try {
      const result = await Promise.race([execution, abort]);
      return result;
    } catch (e) {
      console.log(`[translate] exec failed(${label})`, e);
      return undefined;
    } finally {
      if (cleanup) cleanup();
    }
  };

  // 1) 注入引导(重置 window.__rainseeTranslate,清空 reg)
  console.log(`[translate] before bootstrap exec | len=${bootstrap.length}`);
  const bootstrapOk = await exec(bootstrap, 'bootstrap');
  console.log(`[translate] after bootstrap exec | returned=${bootstrapOk === undefined ? '(aborted)' : 'ok'}`);
  if (isCancelled()) {
    console.log('[translate] runTranslate cancelled after bootstrap');
    return {ok: false, count: 0};
  }

  // 2) 收集文本节点
  const json = await exec(
    COLLECT_WITH_STATS_CODE,
    'collect',
  );
  console.log(`[translate] after collect exec | json_len=${json ? String(json).length : 0}`);
  if (!json) {
    console.log('[translate] runTranslate ABORT: collect() 返回空(页面导航/无 __rainseeTranslate/collect 失败)');
    return {ok: false, count: 0};
  }
  let items: Array<{id: number; text: string}> = [];
  let initialStats: PageTranslateStats | null = null;
  try {
    const parsed = parsePageCollection(json);
    items = parsed.items;
    initialStats = parsed.stats;
  } catch (e) {
    console.log('[translate] collect parse failed', e);
    return {ok: false, count: 0};
  }
  console.log(`[translate-diag] session=${sessionId} stage=collect items=${items.length} page=${JSON.stringify(initialStats)}`);
  logTranslationMemory(wc, sessionId, 'collect', initialStats);
  if (!items.length) return {ok: true, count: 0};

  // 3) 分批翻译并逐批回填(渐进式显示,大页体感更快)。
  //    collect 已给每个待译元素挂上转圈;apply 回填时摘圈,失败用 clear 摘圈。
  //    多批限并发(CONCURRENCY):apply 按 id 回填,乱序完成无妨,缩短整页等待。
  //    取消时停投新批,在途靠 signal abort 快速终止。
  const toLang = engine.mapLang(target);
  // 取页面语境(title/描述)供 LLM 消歧,整页共用一次。微软引擎忽略。
  let context: {title?: string; description?: string} | undefined;
  try {
    const ctxRaw = await exec(CONTEXT_CODE);
    if (ctxRaw) context = JSON.parse(ctxRaw);
  } catch {
    // 取不到语境不影响翻译
  }
  if (isCancelled()) return {ok: false, count: 0};
  const cacheKeyFor = (text: string) => getPageCacheKey(engine, target, pageUrl, text);
  const cachedMap: Record<number, string> = {};
  const uncachedItems: Array<{id: number; text: string}> = [];
  for (const item of items) {
    const cached = getPageTranslation(cacheKeyFor(item.text));
    if (cached === undefined) {
      uncachedItems.push(item);
    } else {
      cachedMap[item.id] = cached;
    }
  }
  if (Object.keys(cachedMap).length) {
    await exec(
      `window.__rainseeTranslate && window.__rainseeTranslate.apply(${JSON.stringify(cachedMap)})`,
      'apply-cache',
    );
  }
  console.log(`[translate] 页面缓存 | 命中=${items.length - uncachedItems.length} 未命中=${uncachedItems.length}`);
  const chunks = chunkTexts(uncachedItems.map((it) => it.text), engine);

  // 预切每批对应的 items(并发下标互不重叠,各批独立 apply/clear)。
  let acc = 0;
  const chunkItems = chunks.map((batch) => {
    const slice = uncachedItems.slice(acc, acc + batch.length);
    acc += batch.length;
    return slice;
  });

  // 单批翻译 + 回填:成功 apply 译文,失败 clear 保原文。返回本批条数。
  const processChunk = async (i: number): Promise<number> => {
    const batch = chunks[i];
    const batchItems = chunkItems[i];
    const batchStartedAt = Date.now();
    console.log(
      `[translate-diag] session=${sessionId} stage=batch-start` +
      ` index=${i + 1}/${chunks.length} items=${batch.length}`,
    );
    let translated: string[];
    try {
      translated = await engine.translateBatch(batch, toLang, signal, context);
      console.log(
        `[translate] batch ${i + 1}/${chunks.length} (${engine.id}): ${batch.length} ok` +
        ` durationMs=${Date.now() - batchStartedAt}`,
      );
    } catch (e) {
      console.log(
        `[translate] batch ${i + 1}/${chunks.length} (${engine.id}) failed, skipping` +
        ` durationMs=${Date.now() - batchStartedAt}`,
        e,
      );
      // 失败:保持原文,摘掉这批元素的转圈,避免永久转圈。
      await exec(
        `window.__rainseeTranslate && window.__rainseeTranslate.clear(${JSON.stringify(batchItems.map((it) => it.id))})`,
        'clear-batch',
      );
      return batch.length;
    }
    if (isCancelled() || pageNavigationAborted) return batch.length;
    const map: Record<number, string> = {};
    batchItems.forEach((it, j) => {
      const value = translated[j] ?? it.text;
      map[it.id] = value;
      cachePageTranslation(cacheKeyFor(it.text), value);
    });
    await exec(
      `window.__rainseeTranslate && window.__rainseeTranslate.apply(${JSON.stringify(map)})`,
      'apply-batch',
    );
    return batch.length;
  };

  // 页面回填依赖不可取消的 executeJavaScript,同一页面仍由 exec 单通道串行。
  // 网络翻译请求允许有限并发,减少大邮件页面的总等待时间,同时避免请求洪峰。
  const CONCURRENCY = 3;
  const stop = () => wc.isDestroyed() || isCancelled() || pageNavigationAborted;
  let cursor = 0;
  let total = items.length - uncachedItems.length;
  const worker = async () => {
    while (!stop()) {
      const i = cursor++;
      if (i >= chunks.length) return;
      total += await processChunk(i);
    }
  };
  const workerCount = Math.min(CONCURRENCY, chunks.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({length: workerCount}, () => worker()));
  }
  logTranslationMemory(wc, sessionId, 'initial-complete');

  // 动态内容监听:初始翻译完成后,页面交互(点按钮展开/弹窗/SPA 局部刷新)新增的文本
  // 节点由 bootstrap 的 MutationObserver 累积,这里每 1s 增量收集翻译+apply。
  // fire-and-forget:靠 stop()/signal 退出(gen 切换/关翻译/导航/换页)。
  let lastDynamicDiagAt = 0;
  const watchDynamic = async () => {
    while (!stop()) {
      await new Promise<void>((r) => setTimeout(r, 1000));
      if (stop()) break;
      let newJson: string | undefined;
      try {
        newJson = await exec(
          COLLECT_NEW_WITH_STATS_CODE,
          'collectNew',
        );
      } catch {
        continue;
      }
      if (!newJson) continue;
      let newItems: Array<{id: number; text: string}> = [];
      let pageStats: PageTranslateStats | null = null;
      try {
        const parsed = parsePageCollection(newJson);
        newItems = parsed.items;
        pageStats = parsed.stats;
      } catch {
        continue;
      }
      const now = Date.now();
      if (now - lastDynamicDiagAt >= 5000 || newItems.length >= 100) {
        lastDynamicDiagAt = now;
        console.log(`[translate-diag] session=${sessionId} stage=dynamic items=${newItems.length} page=${JSON.stringify(pageStats)}`);
        logTranslationMemory(wc, sessionId, 'dynamic', pageStats);
      }
      if (!newItems.length) continue;
      console.log(`[translate] 动态新增 ${newItems.length} 个文本节点,增量翻译`);
      const cachedNewMap: Record<number, string> = {};
      const uncachedNewItems: Array<{id: number; text: string}> = [];
      for (const item of newItems) {
        const cached = getPageTranslation(cacheKeyFor(item.text));
        if (cached === undefined) {
          uncachedNewItems.push(item);
        } else {
          cachedNewMap[item.id] = cached;
        }
      }
      if (Object.keys(cachedNewMap).length) {
        await exec(
          `window.__rainseeTranslate && window.__rainseeTranslate.apply(${JSON.stringify(cachedNewMap)})`,
          'apply-dynamic-cache',
        );
      }
      const newChunks = chunkTexts(uncachedNewItems.map((it) => it.text), engine);
      let off = 0;
      for (let c = 0; c < newChunks.length; c++) {
        if (stop()) break;
        const batch = newChunks[c];
        const batchItems = uncachedNewItems.slice(off, off + batch.length);
        try {
          const translated = await engine.translateBatch(batch, toLang, signal, context);
          if (stop()) break;
          const map: Record<number, string> = {};
          batchItems.forEach((it, j) => {
            const value = translated[j] ?? it.text;
            map[it.id] = value;
            cachePageTranslation(cacheKeyFor(it.text), value);
          });
          await exec(
            `window.__rainseeTranslate && window.__rainseeTranslate.apply(${JSON.stringify(map)})`,
            'apply-dynamic',
          );
        } catch (e) {
          console.log('[translate] 动态批次失败', e);
          await exec(
            `window.__rainseeTranslate && window.__rainseeTranslate.clear(${JSON.stringify(batchItems.map((it) => it.id))})`,
            'clear-dynamic',
          );
        }
        off += batch.length;
      }
    }
    console.log(
      `[translate-diag] session=${sessionId} stage=dynamic-stop` +
      ` destroyed=${wc.isDestroyed()} cancelled=${isCancelled()} navigation=${pageNavigationAborted}`,
    );
    if (!wc.isDestroyed()) logTranslationMemory(wc, sessionId, 'dynamic-stop');
  };
  void watchDynamic();

  return {ok: !stop(), count: total};
};

// 单句翻译(划词):复用当前引擎的 translateBatch([text])。
// 引擎内部已处理重试/回退/限额;此处仅做超长截断(按引擎 maxSingleTextChars)。
// context(可选)携带页面 title/描述供 LLM 消歧,由调用方(application.ts 划词 IPC)从
// preload 载荷取。
export const translateText = async (
  text: string,
  toLang: string,
  context?: {title?: string; description?: string},
): Promise<string> => {
  const engine = getActiveEngine();
  const max = engine.maxSingleTextChars();
  const trimmed = (text || '').slice(0, max);
  if (!trimmed) return '';
  const out = await engine.translateBatch([trimmed], engine.mapLang(toLang), undefined, context);
  return out[0] ?? trimmed;
};

// 原地还原:把文本节点改回原文并移除状态条(不 reload)。引擎无关。
// 必须用 mainFrame 优先:executeInTopPage 走 webContents 级,在 zhso.org 等页面会挂死不抛错,
// fallback 永不触发 → revert 永不执行 → "显示原文"无效。与 runTranslate 的 exec 同款策略。
export const revertTranslate = async (wc: Electron.WebContents): Promise<void> => {
  if (!wc || wc.isDestroyed()) return;
  try {
    await execInPagePreferMainFrame(
      wc,
      'window.__rainseeTranslate && window.__rainseeTranslate.revert()',
      true,
    );
  } catch (e) {
    console.log('[translate] revert failed', e);
  }
};

// 取语言主语种子,如 'zh-CN' → 'zh','en-US' → 'en'。
const primarySubtag = (tag: string) => {
  const t = (tag || '').trim().toLowerCase();
  if (!t) {
    return '';
  }
  return t.split('-')[0] || '';
};

const DETECT_CODE = `(function(){var r='';var h=document.documentElement;if(h){r=(h.getAttribute('lang')||'').trim();}if(!r){var m=document.querySelector('meta[http-equiv="content-language" i]')||document.querySelector('meta[name="language" i]');if(m){r=(m.getAttribute('content')||'').trim().split(',')[0];}}var s='';try{if(document.body){s=(document.body.innerText||'').slice(0,1500);}}catch(e){}return JSON.stringify({lang:r,sample:s});})()`;

// 取页面语境:title + meta description(优先 name=description,退化 og:description)。
// 作为 LLM 消歧参考,如 "Apple" 在科技站 vs 水果站译法不同。微软引擎忽略。
const CONTEXT_CODE = `(function(){var t=document.title||'';var d='';var m=document.querySelector('meta[name="description" i]')||document.querySelector('meta[property="og:description" i]');if(m){d=m.getAttribute('content')||'';}return JSON.stringify({title:t.slice(0,200),description:d.slice(0,500)});})()`;

// 检测页面语言,判断是否需要翻译(页面语言主语种子 ≠ App 语言主语种子)。
// App 通过 --lang=zh-CN 强制 UI 语言(application.ts),app.getLocale() 取之。
export const detectTranslateState = async (
  webContents: Electron.WebContents,
): Promise<{canTranslate: boolean; lang: string}> => {
  if (!webContents || webContents.isDestroyed()) {
    return {canTranslate: false, lang: ''};
  }

  const targetPrimary = primarySubtag(app.getLocale()) || 'zh';

  let pageLang = '';
  let sample = '';
  try {
    const raw = await executeInTopPage(webContents, DETECT_CODE, true);
    const parsed = JSON.parse(raw || '{}') as {lang?: string; sample?: string};
    pageLang = parsed.lang || '';
    sample = parsed.sample || '';
  } catch (error) {
    return {canTranslate: false, lang: ''};
  }

  let primary = primarySubtag(pageLang);

  // 无显式 lang 时,按正文文本嗅探:含汉字 → 中文;含拉丁字母 → 视为外语;
  // 都没有(纯符号/空) → 未知,不提示翻译。
  if (!primary) {
    if (/[一-鿿㐀-䶿]/.test(sample)) {
      primary = 'zh';
    } else if (/[A-Za-z]/.test(sample)) {
      primary = 'en';
    }
  }

  if (!primary) {
    return {canTranslate: false, lang: ''};
  }

  return {
    canTranslate: primary !== targetPrimary,
    lang: primary,
  };
};
