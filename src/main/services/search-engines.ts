import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as http from 'http';
import * as https from 'https';
import { parse } from 'url';

import { getPath } from '~/utils';
import { getIconByUrlNet } from '~/utils/url';
import { buildSearchEngine, IRawSearchEngine } from '~/constants/settings';
import { ISearchEngine } from '~/interfaces';
import { Application } from '../application';

// 后端搜索引擎列表接口（ThinkPHP5 控制器 PcBrowser::searchEngines）
const SEARCH_ENGINES_URL = 'https://api.yjllq.com/api/PcBrowser/searchEngines';

// 云端引擎列表本地缓存（放 userData，应对服务器离线）。
// 与 settings.json 分离：这里是“从云端下载到的原始副本”，
// 服务器离线时用它兜底，避免每次都退回内置默认。
const CACHE_FILE = 'search-engines-cache.json';

interface EnginesCache {
  version: number;
  engines: IRawSearchEngine[];
}

// 以 UTF-8 拉取 JSON（中文 name 需要正确解码）
const fetchJSON = (url: string): Promise<any> =>
  new Promise((resolve2, reject) => {
    const options = parse(url);
    const request =
      options.protocol === 'https:' ? https.request : http.request;
    const req = request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        try {
          resolve2(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

const readCache = async (): Promise<EnginesCache | null> => {
  try {
    const raw = await fs.readFile(resolve(getPath(CACHE_FILE)), 'utf8');
    const json = JSON.parse(raw);
    if (json && Array.isArray(json.engines)) return json;
  } catch {
    // 无缓存
  }
  return null;
};

const writeCache = async (cache: EnginesCache) => {
  try {
    await fs.writeFile(
      resolve(getPath(CACHE_FILE)),
      JSON.stringify(cache),
      'utf8',
    );
  } catch (e) {
    console.error('[search-engines] write cache failed', e);
  }
};

// 校验单条云端引擎数据的合法性（url 必须含 %s 占位符）
const isValidRaw = (e: any): e is IRawSearchEngine =>
  e &&
  typeof e.name === 'string' &&
  e.name.length > 0 &&
  typeof e.url === 'string' &&
  e.url.includes('%s') &&
  typeof e.keyword === 'string' &&
  e.keyword.length > 0;

// 将云端原始引擎列表组装为完整 ISearchEngine（本地生成 icon）。
const toSearchEngines = (raws: IRawSearchEngine[]): ISearchEngine[] =>
  raws.filter(isValidRaw).map(buildSearchEngine);

// 把云端列表合并进当前设置：
//  - 以 keyword 为稳定标识。云端改了某引擎的 url，会按 keyword 命中并替换进去。
//  - 整体顺序、增删都以云端为准（云端是权威来源）。
//  - icon 始终用 getIconByUrlNet(url) 本地重新生成，避免 url 变了 icon 没变。
//  - 关键：用户当前选中的引擎按 keyword 而非下标保留，云端重排后选择不漂移。
const applyEngines = (cloud: ISearchEngine[]) => {
  if (!cloud.length) return;

  const settings = Application.instance.settings;
  const prev = settings.object;

  // 记录用户当前选中引擎的 keyword，用于在新列表里重新定位
  const prevSelected = prev.searchEngines?.[prev.searchEngine];
  const prevKeyword = prevSelected?.keyword;

  let nextIndex = 0;
  if (prevKeyword) {
    const found = cloud.findIndex((e) => e.keyword === prevKeyword);
    if (found >= 0) nextIndex = found;
  }

  // 已是同一份数据则跳过，避免无意义的落盘与广播
  const same =
    JSON.stringify(prev.searchEngines) === JSON.stringify(cloud) &&
    prev.searchEngine === nextIndex;
  if (same) return;

  settings.updateSettings({
    searchEngines: cloud,
    searchEngine: nextIndex,
  });
};

// 启动时同步一次：优先用云端；失败则回退本地缓存。
const syncOnStartup = async () => {
  try {
    const json = await fetchJSON(SEARCH_ENGINES_URL);
    if (json && json.code === 0 && json.data && Array.isArray(json.data.engines)) {
      const raws: IRawSearchEngine[] = json.data.engines.filter(isValidRaw);
      if (raws.length) {
        await writeCache({
          version: Number(json.data.version) || 0,
          engines: raws,
        });
        applyEngines(toSearchEngines(raws));
        return;
      }
    }
    throw new Error('invalid cloud response');
  } catch (e) {
    // 服务器离线 / 响应异常：回退到本地缓存（若有）
    console.error('[search-engines] cloud sync failed, fallback to cache', e);
    const cache = await readCache();
    if (cache && cache.engines.length) {
      applyEngines(toSearchEngines(cache.engines));
    }
    // 无缓存时不动，保留内置 DEFAULT_SEARCH_ENGINES
  }
};

export const runSearchEnginesService = () => {
  // 渲染层（设置页）可主动触发一次同步
  ipcMain.handle('sync-search-engines', async () => {
    await syncOnStartup();
    return Application.instance.settings.object.searchEngines;
  });

  // 浏览器启动后同步一次
  syncOnStartup();
};
