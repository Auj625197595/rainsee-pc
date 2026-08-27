// Favicon 完整解析模块。
//
// 两条互补的下载路径,最终都产出 {dataUrl, score}:
//   - resolveBestFavicon:主进程 requestURL 下载(带 Chrome UA + Referer),快路径,
//     给 page-favicon-updated 用。多数站点够用,但缺 Cookie / 被反爬时会 404。
//   - fetchFaviconFromPage:did-finish-load 时注入脚本,在页面上下文里 fetch
//     (自动带 cookie / 同源 UA / Referer)+ 转 base64 回传,可靠路径,覆盖前者。
//
// 主进程拿到 dataUrl 后复用 storage.processFaviconBuffer(ico→png + 缓存)。

import type {StorageService} from './storage';

// Favicon 候选项:URL + 从页面 sizes 属性 / rel 推断的尺寸线索(0 表示未知)。
export interface FaviconCandidate {
  url: string;
  sizeHint?: number;
}

// 已解析并下载成功的 favicon:data URL + 其候选评分(供调用方比较优劣)。
export interface ResolvedFavicon {
  dataUrl: string;
  score: number;
}

// requestURL 本身无超时,慢响应会让候选串行循环卡死。3s 后放弃跳下一个。
const FAVICON_FETCH_TIMEOUT = 3000;

// 取 URL 路径末尾的扩展名(小写),无则空串。用于按格式给 favicon 评分。
const extOf = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return m ? m[1].toLowerCase() : '';
  } catch {
    const m = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return m ? m[1].toLowerCase() : '';
  }
};

// Favicon 质量评分,越高越优。综合格式(svg>png>其它位图>ico)、尺寸线索、
// 是否 apple-touch-icon(通常 180 高清)、协议(https 更稳)。
// 同分保持原顺序(V8 sort 稳定),避免候选间无谓抖动。
export const scoreFavicon = (url: string, sizeHint = 0): number => {
  let score = 0;
  const ext = extOf(url);

  if (ext === 'svg') score += 1000;
  else if (ext === 'png') score += 500;
  else if (ext === 'ico') score += 100;
  else if (ext) score += 300; // jpg/gif/webp 等其它位图

  if (sizeHint > 0) score += Math.min(sizeHint, 256);
  if (/apple-touch-icon/i.test(url)) score += 50;
  if (/^https:\/\//i.test(url)) score += 10;

  return score;
};

// 给 addFavicon 套一层超时。超时或下载失败均 reject,由 resolveBestFavicon
// 捕获后跳到下一个候选。fetchP.catch 吞掉晚到的 reject,避免超时后 addFavicon
// 仍 reject 触发 unhandledRejection(参考 bookmarks.ts 的 timeout race 范式)。
const addFaviconWithTimeout = (
  storage: StorageService,
  url: string,
  referer?: string,
): Promise<string> => {
  const fetchP = storage.addFavicon(url, referer);
  fetchP.catch(() => {});

  let timer: NodeJS.Timeout | undefined;

  return Promise.race([
    fetchP,
    new Promise<string>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('favicon fetch timeout')),
        FAVICON_FETCH_TIMEOUT,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

// 从候选列表挑最优 favicon 并下载缓存。过滤 http(s) + 去重 → 按评分降序 →
// 串行尝试(第一个成功即返回),全失败返回 null。
// 复用 storage.addFavicon:已命中本地缓存(storage.favicons)时零网络开销直接返回。
export const resolveBestFavicon = async (
  candidates: FaviconCandidate[],
  storage: StorageService,
  referer?: string,
): Promise<ResolvedFavicon | null> => {
  const seen = new Set<string>();
  const ranked: {url: string; score: number}[] = [];

  for (const c of candidates) {
    const url = c && c.url;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    ranked.push({url, score: scoreFavicon(url, c.sizeHint || 0)});
  }

  ranked.sort((a, b) => b.score - a.score);

  console.log(
    `[favicon] resolveBestFavicon: ${ranked.length} http(s) candidate(s)`,
  );
  ranked.forEach((r, i) =>
    console.log(`  [${i}] score=${r.score}  ${r.url}`),
  );

  for (const {url, score} of ranked) {
    try {
      const dataUrl = await addFaviconWithTimeout(storage, url, referer);
      if (dataUrl) {
        console.log(`[favicon] ✓ picked score=${score}  ${url}`);
        return {dataUrl, score};
      }
    } catch (e) {
      console.warn(
        `[favicon] ✗ fetch failed: ${url}  (${(e as Error).message})`,
      );
    }
  }

  console.log(`[favicon] resolveBestFavicon: all candidates failed`);
  return null;
};

// 注入页面的 async IIFE:在页面上下文里收集普通 favicon <link> + /favicon.ico,
// 按质量评分排序,逐个用页面 fetch(自动带 cookie / 同源 UA / Referer)下载,
// 转 base64 后返回 JSON。用页面网络栈而非主进程裸 requestURL——后者因缺 UA /
// Cookie 常被服务器 404。executeJavaScript 的 await 返回值即"桥":脚本 return 的
// base64 字符串经 IPC 回到主进程(字符串可结构化克隆,无 Blob 传输问题)。
// mask-icon 是 Safari 固定标签页使用的单色模板，不应覆盖浏览器标签页 favicon。
//   - credentials:'include' 让需登录才可见的 favicon 也带 cookie。
//   - 跨域 CDN 图标若 CORS 失败,fetch 抛错 → 跳过该候选(不影响同源)。
//   - blob > 512KB 跳过(防异常大文件拖慢 base64 编码与 IPC 传输)。
const FAVICON_FETCH_CODE = `(async function(){var SEL='link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="apple-touch-icon-precomposed"]';function extOf(u){var q=u.indexOf('?');if(q<0)q=u.indexOf('#');if(q<0)q=u.length;var p=u.slice(0,q);var d=p.lastIndexOf('.');return d<0?'':p.slice(d+1).toLowerCase()}function score(u,sh){var e=extOf(u);var s=0;if(e==='svg')s=1000;else if(e==='png')s=500;else if(e==='ico')s=100;else if(e)s=300;if(sh>0)s+=Math.min(sh,256);if(u.indexOf('apple-touch-icon')>=0)s+=50;if(u.indexOf('https://')===0)s+=10;return s}var seen={};var list=[];function push(u,sh){try{u=new URL(u,document.baseURI).href}catch(e){return}if(u.indexOf('http')!==0)return;if(seen[u])return;seen[u]=1;list.push({url:u,score:score(u,sh)})}var ns=document.querySelectorAll(SEL);for(var i=0;i<ns.length;i++){var n=ns[i];var href=n.getAttribute('href');if(!href)continue;var sz=n.getAttribute('sizes')||'';var sh=0;var m=sz.match(/(\\d+)x\\d+/i);if(m)sh=parseInt(m[1],10);if(sz.indexOf('any')>=0)sh=512;var rel=n.getAttribute('rel')||'';if(rel.indexOf('apple-touch-icon')>=0&&!sh)sh=180;push(href,sh)}push('/favicon.ico',0);list.sort(function(a,b){return b.score-a.score});function toB64(buf){var bytes=new Uint8Array(buf);var bin='';var ch=0x8000;for(var i=0;i<bytes.length;i+=ch){bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+ch))}return btoa(bin)}for(var j=0;j<list.length;j++){var c=list[j];try{var r=await fetch(c.url,{credentials:'include'});if(!r.ok||r.status===404)continue;var blob=await r.blob();if(!blob||blob.size===0||blob.size>524288)continue;var buf=await blob.arrayBuffer();return JSON.stringify({ok:true,url:c.url,score:c.score,b64:toB64(buf)})}catch(e){continue}}return JSON.stringify({ok:false})})()`;

// 在页面上下文执行 FAVICON_FETCH_CODE,脚本内已 fetch + 转 base64。
// 主进程解码 base64 → Buffer → 复用 storage.processFaviconBuffer(ico→png + 缓存)。
// wc 已销毁 / executeJavaScript 抛错(CSP 拦截、错误页) / 脚本未拿到图标 均返回 null。
export const fetchFaviconFromPage = async (
  wc: Electron.WebContents,
  storage: StorageService,
): Promise<ResolvedFavicon | null> => {
  if (!wc || wc.isDestroyed()) return null;

  let parsed: any;
  try {
    const raw = await wc.executeJavaScript(FAVICON_FETCH_CODE, true);
    parsed = JSON.parse(raw || '{}');
  } catch (e) {
    console.warn(
      `[favicon] page fetch execute error: ${(e as Error).message}`,
    );
    return null;
  }

  if (!parsed || !parsed.ok || !parsed.b64 || !parsed.url) {
    console.log(`[favicon] page fetch: no usable icon`);
    return null;
  }

  // 防 base64 过大:异常大的 data URL 经 IPC 传回后,Buffer.from / ico→png 转换 /
  // 渲染层 img 加载都可能 OOM。脚本侧已限 blob<512KB,这里按 base64 字符串长度
  // 兜底(字符串长度校验廉价,先于 Buffer.from 拦截)。2MB base64 ≈ 1.5MB 图片。
  const b64 = parsed.b64;
  if (typeof b64 !== 'string' || b64.length > 2 * 1024 * 1024) {
    console.warn(
      `[favicon] page fetch: base64 too large (${typeof b64 === 'string' ? b64.length : NaN} chars), skipped`,
    );
    return null;
  }

  try {
    const buf = Buffer.from(b64, 'base64');
    const dataUrl = await storage.processFaviconBuffer(parsed.url, buf);
    console.log(`[favicon] page fetch ✓ score=${parsed.score}  ${parsed.url}`);
    return {dataUrl, score: parsed.score || 0};
  } catch (e) {
    console.warn(
      `[favicon] page fetch process error: ${(e as Error).message}`,
    );
    return null;
  }
};
