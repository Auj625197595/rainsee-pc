import {app, ipcMain} from 'electron';
import {readFileSync} from 'fs';
import {join} from 'path';

import {getWebUIURL} from '~/common/webui';
import {Application} from '../application';

// AI 调用、prompt 构建、密钥都放在后端，这里只把请求转发给
// ThinkPHP 控制器 SearchAnnotator::analyze，避免在客户端泄露密钥、逻辑两处维护。
const ANALYZE_ENDPOINT = 'https://api.yjllq.com/api/Searchannotator/analyze';

export interface SearchAnnotatorItemInput {
  position: number;
  title: string;
  url: string;
  introduction: string;
  className?: string;
}

export interface SearchAnnotatorAnalyzePayload {
  query: string;
  engine?: string;
  pageUrl?: string;
  items: SearchAnnotatorItemInput[];
}

export interface SearchAnnotatorResultItem {
  position: number;
  score: number;
  reason: string;
}

let cachedScript = '';

const clampScore = (score: number) => {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(5, Math.round(score)));
};

const cleanText = (value: string, maxLength: number) =>
  (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

export const analyzeSearchResults = async (
  payload: SearchAnnotatorAnalyzePayload,
): Promise<{query: string; answer: string; items: SearchAnnotatorResultItem[]; degraded?: boolean}> => {
  const items = (payload.items || []).slice(0, 10);
  if (!payload.query || items.length === 0) {
    return {query: payload.query || '', answer: '', items: []};
  }

  // 用 Node 原生 fetch(undici) 而不是 cross-fetch: cross-fetch 在 Node 下走 node-fetch,
  // 它对这个后端的 gzip 响应做 Gunzip 解压时会抛 ERR_STREAM_PREMATURE_CLOSE / "Premature close"
  // (接口本身正常)。原生 fetch 的解压没有这个问题, 同主机其它接口也都用原生 fetch。
  //
  // AbortController: 后端偶尔会接受连接但不响应(网络中间设备/AI 模型卡住), 原生 fetch 没有
  // 默认超时会永远挂起 → IPC 不返回 → 渲染端 isAnalyzing 永远不清 → 标注卡在「分析中」。
  // 20s 超时(渲染端另有 25s 兜底), 超时返回 degraded 让渲染端保留旧分, 不覆写成 0。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(ANALYZE_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      signal: controller.signal,
      body: JSON.stringify({
        query: payload.query,
        engine: payload.engine || '',
        pageUrl: payload.pageUrl || '',
        items: items.map((item) => ({
          position: item.position,
          title: item.title,
          url: item.url,
          introduction: item.introduction,
        })),
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`search annotator backend error: ${response.status}`);
  }

  const data: any = await response.json();
  const result = data?.result || {};
  const resultItems = Array.isArray(result.items) ? result.items : [];
  const answer = cleanText(typeof result.answer === 'string' ? result.answer : '', 50);
  const scoreMap = new Map<number, any>();

  resultItems.forEach((item: any) => {
    const position = Number(item?.position);
    if (position) {
      scoreMap.set(position, item);
    }
  });

  return {
    query: payload.query,
    answer,
    items: items.map((item) => {
      const matched = scoreMap.get(item.position) || {};

      return {
        position: item.position,
        score: clampScore(Number(matched.score)),
        reason: cleanText(matched.reason || '', 30),
      };
    }),
  };
};

const getSearchAnnotatorScript = () => {
  if (cachedScript) {
    return cachedScript;
  }

  const scriptPath = join(app.getAppPath(), 'static', 'scripts', 'search-annotator.js');
  cachedScript = readFileSync(scriptPath, 'utf8');
  return cachedScript;
};

const isSupportedSearchPage = (url: string) => {
  try {
    const parsed = new URL(url);
    if (/(^|\.)baidu\.com$/i.test(parsed.hostname) && parsed.pathname === '/s') {
      return true;
    }

    if (/(^|\.)bing\.com$/i.test(parsed.hostname) && parsed.pathname === '/search') {
      return true;
    }

    if (/(^|\.)google\./i.test(parsed.hostname) && parsed.pathname === '/search') {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
};

export const injectSearchAnnotator = async (webContents: Electron.WebContents) => {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  // 受设置开关控制:关闭时不注入,搜索页恢复原样。
  const settings = Application.instance.settings.object as any;
  if (settings && settings.searchAnnotator === false) {
    console.log('[search-annotator] inject 跳过: 设置已关闭');
    return;
  }

  const pageUrl = webContents.getURL();
  if (!isSupportedSearchPage(pageUrl)) {
    return;
  }

  console.log('[search-annotator] inject 注入脚本', pageUrl);
  const script = getSearchAnnotatorScript();
  await webContents.executeJavaScript(script, true).catch((error) => {
    console.log('[search-annotator] inject failed', error);
  });
};

export const setupSearchAnnotatorIpc = () => {
  ipcMain.removeHandler('search-annotator-analyze');
  ipcMain.handle('search-annotator-analyze', async (_event, payload) => {
    // 标注是非关键 UI 功能: 后端失败时降级返回空结果, 别让 IPC 抛未处理错误把气泡打挂。
    const itemCount = ((payload && payload.items) || []).length;
    const query = (payload && payload.query) || '';
    const startedAt = Date.now();
    console.log('[search-annotator] analyze IPC 进入', {query, itemCount});
    try {
      const result = await analyzeSearchResults(payload);
      console.log(
        '[search-annotator] analyze IPC 成功',
        Date.now() - startedAt + 'ms',
        result.items.map((i) => 'p' + i.position + '=' + i.score),
      );
      return result;
    } catch (error) {
      console.log(
        '[search-annotator] analyze IPC 异常(降级, 保留渲染端旧分)',
        Date.now() - startedAt + 'ms',
        error,
      );
      // 返回 degraded 而不是 0 分: 渲染端据此跳过 applyScores, 保留已显示的分数,
      // 避免后端异常/超时把「强相关」覆写成「不推荐」或「分析中」。
      return {
        query: (payload && payload.query) || '',
        answer: '',
        items: [],
        degraded: true,
      };
    }
  });

  // 气泡右上角齿轮:在当前窗口新建标签页打开 设置-地址栏。
  ipcMain.removeHandler('search-annotator-open-settings');
  ipcMain.handle('search-annotator-open-settings', async () => {
    const appWindow = Application.instance.windows.current;
    if (!appWindow) {
      return false;
    }

    appWindow.viewManager.create({
      url: `${getWebUIURL('settings')}?section=address-bar`,
      active: true,
    });
    return true;
  });
};
