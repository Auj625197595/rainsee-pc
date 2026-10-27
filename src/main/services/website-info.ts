import {BrowserView, ipcMain, session} from 'electron';

const VERSION = 1;
// 单次解析（加载+抓图标）的总预算；主页侧的桥接超时（15s）略大于此值。
const PARSE_DEADLINE_MS = 13_000;
// SPA 常在挂载后才通过 JS 注入 favicon，加载完成后稍候再提取。
const PAGE_SETTLE_MS = 1_200;
const ICON_FETCH_TIMEOUT_MS = 8_000;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_ICON_TRIES = 5;
const PARSER_PARTITION = 'website-info-parse';

type ParsedInfo = {
  title?: string;
  description?: string;
  icon?: string;
  backgroundColor?: string;
};

type ParseResult = {
  version: number;
  requestId: string;
  ok: boolean;
  reason?: string;
  url?: string;
  info?: ParsedInfo;
};

interface IconCandidate {
  href: string;
  rel: string;
  sizes: string;
  type: string;
}

const EXTRACT_SCRIPT = `(function () {
  var abs = function (href) {
    try { return new URL(href, document.baseURI).href; } catch (e) { return ''; }
  };
  var meta = function (selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      var content = el ? (el.getAttribute('content') || '').trim() : '';
      if (content) return content;
    }
    return '';
  };
  var candidates = [];
  var links = document.querySelectorAll('link[rel]');
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    var rel = (link.getAttribute('rel') || '').toLowerCase();
    if (rel.indexOf('icon') === -1 || rel.indexOf('mask-icon') !== -1) continue;
    var href = abs(link.getAttribute('href') || '');
    if (!href || !/^https?:/i.test(href)) continue;
    candidates.push({
      href: href,
      rel: rel,
      sizes: (link.getAttribute('sizes') || '').toLowerCase(),
      type: (link.getAttribute('type') || '').toLowerCase(),
    });
  }
  return {
    title: (document.title || '').trim(),
    description: meta(['meta[name="description" i]', 'meta[property="og:description" i]']),
    themeColor: meta(['meta[name="theme-color" i]']),
    candidates: candidates,
    fallbackIcon: abs('favicon.ico'),
  };
})();`;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// 尺寸/类型越接近卡片展示（≥96 且 ≤256，svg 可缩放）越优先。
function iconScore(candidate: IconCandidate): number {
  if (candidate.type.includes('svg') || /\.svg(\?|#|$)/i.test(candidate.href)) return 1000;
  let best = 0;
  const re = /(\d{1,4})x(\d{1,4})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(candidate.sizes))) {
    best = Math.max(best, Number(match[1]), Number(match[2]));
  }
  if (candidate.rel.includes('apple-touch-icon')) best = Math.max(best, 180);
  if (best >= 96 && best <= 256) return 800 + Math.round(160 - Math.abs(best - 160));
  if (best > 256) return 600;
  if (best > 0) return best;
  return 100;
}

function detectMime(contentType: string, buffer: Buffer): string {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (/^image\//.test(type)) return type;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
  if (buffer.subarray(0, 256).toString('utf8').includes('<svg')) return 'image/svg+xml';
  return '';
}

function normalizeColor(value: unknown): string {
  const text = String(value || '').trim();
  return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(text) ? text : '';
}

function reasonOf(error: unknown): string {
  const message = String((error as Error)?.message || error || '');
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('render process gone')) return 'render-gone';
  return 'load-failed';
}

let parserSession: Electron.Session | null = null;

// 解析专用内存分区：不落盘、不进用户历史/缓存，也不共享登录态。
function getParserSession(): Electron.Session {
  if (parserSession) return parserSession;
  const ses = session.fromPartition(PARSER_PARTITION, {cache: false});
  // 隐藏视图里不应弹出任何权限申请（地理定位/摄像头等）。
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  parserSession = ses;
  return ses;
}

/** Main-process fallback for GoTab's「获取信息」: parse a page in a hidden
 *  BrowserView and return title/description/icon(base64) for LAN addresses
 *  or when the remote getWebsiteInfo API has no icon. */
export class WebsiteInfoService {
  public constructor() {
    ipcMain.handle('newtab-website-info', (event, payload) => {
      const requestId = String(payload?.requestId || '').slice(0, 120);
      if (!this.isNewtabShell(event.sender.getURL())
        || !payload
        || Number(payload.version) !== VERSION
        || !requestId
        || typeof payload.url !== 'string') {
        return {version: VERSION, requestId, ok: false, reason: 'invalid'};
      }
      console.info('[website-info] parse requested', {url: payload.url});
      return this.parse(payload.url, requestId);
    });
  }

  private isNewtabShell(url: string): boolean {
    return /^(yjllq:|http:\/\/localhost:4444\/).*newtab/i.test(String(url || ''));
  }

  private async parse(rawUrl: string, requestId: string): Promise<ParseResult> {
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      return {version: VERSION, requestId, ok: false, reason: 'invalid'};
    }
    if (!/^https?:$/.test(target.protocol)) {
      return {version: VERSION, requestId, ok: false, reason: 'invalid'};
    }

    // 隐藏 BrowserView：不挂到任何窗口，仅用于解析页面内容。
    const view = new BrowserView({
      webPreferences: {
        partition: PARSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    try {
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({action: 'deny'}));
      getParserSession();
      return await withDeadline(this.parseInView(view, target, requestId), PARSE_DEADLINE_MS);
    } catch (error) {
      console.warn('[website-info] parse failed', {url: rawUrl, error});
      return {version: VERSION, requestId, ok: false, reason: reasonOf(error)};
    } finally {
      this.disposeView(view);
    }
  }

  private async parseInView(view: BrowserView, target: URL, requestId: string): Promise<ParseResult> {
    const contents = view.webContents;
    let crashReject: ((error: Error) => void) | null = null;
    const crashed = new Promise<never>((_, reject) => {
      crashReject = reject;
    });
    contents.once('render-process-gone', () => crashReject?.(new Error('render process gone')));

    const page = await Promise.race([this.loadAndExtract(contents, target), crashed]);
    const info: ParsedInfo = {
      title: String(page?.title || '').slice(0, 300),
      description: String(page?.description || '').slice(0, 1000),
      backgroundColor: normalizeColor(page?.themeColor),
      icon: '',
    };
    info.icon = await Promise.race([
      this.findIcon(contents, page, target),
      crashed,
    ]);
    const result: ParseResult = {
      version: VERSION,
      requestId,
      ok: true,
      url: contents.getURL(),
      info,
    };
    console.info('[website-info] parse done', {
      url: target.href,
      title: info.title,
      icon: Boolean(info.icon),
    });
    return result;
  }

  private async loadAndExtract(contents: Electron.WebContents, target: URL) {
    try {
      await contents.loadURL(target.href);
    } catch (error) {
      // ERR_ABORTED：加载被页面自身的跳转（meta refresh 等）打断，按最终页面继续。
      if (!String((error as Error)?.message || error).includes('ERR_ABORTED')) throw error;
      console.info('[website-info] load interrupted by in-page navigation, continuing', {url: target.href});
    }
    await delay(PAGE_SETTLE_MS);
    return contents.executeJavaScript(EXTRACT_SCRIPT, true);
  }

  private async findIcon(contents: Electron.WebContents, page: any, target: URL): Promise<string> {
    const candidates: Array<{href: string; score: number}> = [];
    for (const item of (Array.isArray(page?.candidates) ? page.candidates : []) as IconCandidate[]) {
      if (!item || typeof item.href !== 'string' || !/^https?:/i.test(item.href)) continue;
      candidates.push({href: item.href, score: iconScore(item)});
    }
    candidates.sort((a, b) => b.score - a.score);
    const seen = new Set(candidates.map((candidate) => candidate.href));
    // <link> 缺失时按站点根路径兜底（大量站点只提供 /favicon.ico）。
    for (const fallback of [
      typeof page?.fallbackIcon === 'string' ? page.fallbackIcon : '',
      new URL('/favicon.ico', target.origin).href,
    ]) {
      if (fallback && /^https?:/i.test(fallback) && !seen.has(fallback)) {
        seen.add(fallback);
        candidates.push({href: fallback, score: 0});
      }
    }
    console.info('[website-info] icon candidates', {
      url: target.href,
      candidates: candidates.map((candidate) => ({
        href: candidate.href.slice(0, 160),
        score: candidate.score,
      })),
    });

    for (const candidate of candidates.slice(0, MAX_ICON_TRIES)) {
      try {
        const dataUrl = await this.fetchIconDataUrl(contents.session, candidate.href);
        if (dataUrl) {
          console.info('[website-info] icon fetched', {
            href: candidate.href.slice(0, 160),
            bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4),
          });
          return dataUrl;
        }
        console.info('[website-info] icon candidate empty/oversized', {
          href: candidate.href.slice(0, 160),
        });
      } catch (error) {
        console.warn('[website-info] icon fetch failed', {href: candidate.href, error});
      }
    }
    console.info('[website-info] no icon found', {url: target.href});
    return '';
  }

  private async fetchIconDataUrl(ses: Electron.Session, url: string): Promise<string> {
    // 老版 TS lib 没有 AbortSignal.timeout，手动用 AbortController 控制超时。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);
    try {
      const response = await ses.fetch(url, {signal: controller.signal});
      if (!response.ok) return '';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_ICON_BYTES) return '';
      const mime = detectMime(response.headers.get('content-type') || '', buffer);
      if (!mime) return '';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } finally {
      clearTimeout(timer);
    }
  }

  private disposeView(view: BrowserView) {
    try {
      view.webContents.close({waitForBeforeUnload: false});
    } catch {
      // 页面可能已自行销毁。
    }
  }
}
