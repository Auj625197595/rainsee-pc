import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as http from 'http';
import * as https from 'https';
import { parse } from 'url';

import { getPath } from '~/utils';

// 后端智能播放器白名单接口（ThinkPHP5 控制器 PcBrowser::videoPlayerWhitelist）。
// 命中 host：不嗅探视频、地址栏不显示播放器图标。
const VIDEO_PLAYER_WHITELIST_URL = 'https://api.yjllq.com/api/PcBrowser/videoPlayerWhitelist';

// 云端白名单本地缓存（放 userData），服务器离线时兜底。
const CACHE_FILE = 'video-player-whitelist-cache.json';

interface WhitelistCache {
  version: number;
  hosts: string[];
}

// 当前生效的白名单 host（小写）。filterVideo / addVideoUrl 据此判定是否抑制嗅探。
let activeHosts: string[] = [];

// 以 UTF-8 拉取 JSON（与 search-engines.ts 同款，避免依赖 fetch）
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

const readCache = async (): Promise<WhitelistCache | null> => {
  try {
    const raw = await fs.readFile(resolve(getPath(CACHE_FILE)), 'utf8');
    const json = JSON.parse(raw);
    if (json && Array.isArray(json.hosts)) return json;
  } catch {
    // 无缓存
  }
  return null;
};

const writeCache = async (cache: WhitelistCache) => {
  try {
    await fs.writeFile(
      resolve(getPath(CACHE_FILE)),
      JSON.stringify(cache),
      'utf8',
    );
  } catch (e) {
    console.error('[video-player-whitelist] write cache failed', e);
  }
};

// 规范化云端 host 列表：小写、去空白、去协议/端口/路径，仅保留 host 段，去重。
const normalizeHosts = (raw: any[]): string[] => {
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    let h = item.toLowerCase().trim();
    if (!h) continue;
    if (h.includes('://')) {
      try {
        h = new URL(h).hostname;
      } catch {
        continue;
      }
    } else {
      h = h.split('/')[0];
    }
    h = h.split(':')[0];
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
};

// 启动时同步一次：优先云端；失败回退本地缓存。
const syncOnStartup = async () => {
  try {
    const json = await fetchJSON(VIDEO_PLAYER_WHITELIST_URL);
    if (json && json.code === 0 && json.data && Array.isArray(json.data.hosts)) {
      const hosts = normalizeHosts(json.data.hosts);
      await writeCache({
        version: Number(json.data.version) || 0,
        hosts,
      });
      activeHosts = hosts;
      return;
    }
    throw new Error('invalid cloud response');
  } catch (e) {
    // 服务器离线 / 响应异常：回退到本地缓存（若有）
    console.error('[video-player-whitelist] cloud sync failed, fallback to cache', e);
    const cache = await readCache();
    if (cache && cache.hosts.length) {
      activeHosts = normalizeHosts(cache.hosts);
    }
    // 无缓存时白名单为空：行为与未配置一致（正常嗅探视频）
  }
};

// 当前页 host 是否命中白名单：精确相等，或 host 为白名单某项的子域
// （填主域 bilibili.com 时，www.bilibili.com / m.bilibili.com 均命中）。
export const isVideoPlayerWhitelistedHost = (host: string | null | undefined): boolean => {
  const h = (host || '').toLowerCase().trim();
  if (!h) return false;
  for (const entry of activeHosts) {
    if (!entry) continue;
    if (h === entry) return true;
    if (h.endsWith('.' + entry)) return true;
  }
  return false;
};

// 暴露当前生效列表（调试 / 设置页将来可读）。
export const getVideoPlayerWhitelist = (): string[] => activeHosts.slice();

export const runVideoPlayerWhitelistService = () => {
  // 浏览器启动后同步一次
  syncOnStartup();
};
