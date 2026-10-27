import {app, net, ipcMain, shell} from 'electron';
import {existsSync, promises as fsp} from 'fs';
import {resolve, parse as parsePath} from 'path';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';
import {getWebUIURL} from '~/common/webui-main';
import {showPageToast} from '../menus/common-actions';

// 阅读模式:在原网页提取正文 → 暂存 → 新标签页 yjllq://reader?id= 排版展示。
// 一键保存:阅读页把已净化的正文交回主进程,主进程带原网页 Referer/Cookie 拉图内联成
// 离线 HTML(或 Markdown)直接写入下载目录,不弹保存框。
// 正文 HTML 来自不可信网页,阅读页渲染前会再按白名单净化一次(信任边界在阅读页)。

export interface ReaderArticle {
  title: string;
  byline: string;
  siteName: string;
  published: string;
  lang: string;
  dir: string;
  contentHtml: string;
  textLength: number;
  pageUrl: string;
}

interface ReaderSession {
  article: ReaderArticle;
  referer: string;
  cookies: string;
  userAgent: string;
}

const readerCache = new Map<string, ReaderSession>();
// 只允许「在文件夹中显示」本模块写出的文件。
const savedPaths = new Set<string>();
let registered = false;

const MIN_TEXT_LENGTH = 140;
const MAX_CONTENT_CHARS = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 80 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15000;

// ──────────────────────────────────────────────────────────────────────────
// 注入到原网页执行:打分选正文容器,按白名单重建一份干净 DOM 并序列化返回。
// ⚠️ 此函数会被 .toString() 序列化注入页面,内部禁止引用任何外部作用域变量。
// ──────────────────────────────────────────────────────────────────────────
const extractArticle = function () {
  const base = document.baseURI;
  const abs = (href: string): string => {
    if (!href) return '';
    try {
      return new URL(href, base).href;
    } catch {
      return '';
    }
  };
  const meta = (...names: string[]): string => {
    for (const n of names) {
      const el =
        document.querySelector(`meta[property="${n}"]`) ||
        document.querySelector(`meta[name="${n}"]`) ||
        document.querySelector(`meta[itemprop="${n}"]`);
      const v = el && el.getAttribute('content');
      if (v && v.trim()) return v.trim();
    }
    return '';
  };
  const textOf = (el: Element | null) =>
    el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';

  const NEGATIVE =
    /(^|[\s_-])(comment|comments|meta|footer|footnote|foot|sidebar|side|widget|nav|navbar|menu|breadcrumb|share|sharing|social|sns|related|recommend|promo|sponsor|ad|ads|advert|banner|popup|modal|login|subscribe|newsletter|toolbar|tags?|pagination|pager|copyright|disclaimer|hidden|hot|rank|download-app|qrcode)([\s_-]|$)/i;
  const POSITIVE =
    /article|body|content|entry|main|page|post|text|blog|story|rich_media|markdown|detail|news|prose/i;

  const classWeight = (el: Element): number => {
    let w = 0;
    const s = `${el.className && typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
    if (!s.trim()) return 0;
    // 负向词优先:article-footer / post-comments 这类不能被正向词抵消。
    if (NEGATIVE.test(s)) return -25;
    if (POSITIVE.test(s)) w += 25;
    return w;
  };

  const linkDensity = (el: Element): number => {
    const total = textOf(el).length;
    if (!total) return 0;
    let linkLen = 0;
    const links = el.getElementsByTagName('a');
    for (let i = 0; i < links.length; i++) linkLen += textOf(links[i]).length;
    return linkLen / total;
  };

  const hiddenCache = new WeakMap<Element, boolean>();
  const isHidden = (el: Element): boolean => {
    const c = hiddenCache.get(el);
    if (c !== undefined) return c;
    let h = false;
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') {
      h = true;
    } else {
      const s = window.getComputedStyle(el);
      h = s.display === 'none' || s.visibility === 'hidden';
    }
    hiddenCache.set(el, h);
    return h;
  };

  // 1) 已知正文选择器(覆盖主流 CMS / 公众号 / 知乎 / 简书等)。
  const KNOWN = [
    '#js_content',
    '.rich_media_content',
    '[itemprop="articleBody"]',
    '.RichText.ztext',
    '.Post-RichText',
    'article .markdown-body',
    '.markdown-body',
    '.article-content',
    '.article_content',
    '.article-body',
    '.post-content',
    '.post-body',
    '.entry-content',
    '.content-article',
    '#article_content',
    '#content_views',
    '.show-content',
    'article',
  ];
  let top: Element | null = null;
  // 最终要复制的正文块(通常只有 top;兄弟块合并时为多个)。
  let parts: Element[] = [];
  for (const sel of KNOWN) {
    const list = Array.from(document.querySelectorAll(sel));
    // 多个 article(列表页)时取正文最长的一个。
    let best: Element | null = null;
    let bestLen = 0;
    for (const el of list) {
      if (isHidden(el)) continue;
      const len = textOf(el).length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    if (best && bestLen >= 200 && linkDensity(best) < 0.5) {
      top = best;
      break;
    }
  }

  // 2) 打分:段落文本把分数加给父/祖父容器。
  if (!top) {
    const scores = new Map<Element, number>();
    const add = (el: Element | null, v: number) => {
      if (!el || el === document.documentElement) return;
      if (!scores.has(el)) scores.set(el, classWeight(el));
      scores.set(el, (scores.get(el) || 0) + v);
    };
    const nodes = document.querySelectorAll('p, pre, td, blockquote, li, section > span, div');
    nodes.forEach((node) => {
      // div 只在它直接包含文本时当段落看。
      if (node.tagName === 'DIV') {
        let direct = '';
        node.childNodes.forEach((c) => {
          if (c.nodeType === 3) direct += c.textContent || '';
        });
        if (direct.trim().length < 25) return;
      }
      const text = textOf(node);
      if (text.length < 25) return;
      if (isHidden(node)) return;
      const v = 1 + (text.split(/[,，。、;；]/).length - 1) + Math.min(Math.floor(text.length / 100), 3);
      add(node.parentElement, v);
      add(node.parentElement && node.parentElement.parentElement, v / 2);
    });
    let bestScore = 0;
    const finalScore = (el: Element) => (scores.get(el) || 0) * (1 - linkDensity(el));
    scores.forEach((_s, el) => {
      const score = finalScore(el);
      if (score > bestScore) {
        bestScore = score;
        top = el;
      }
    });
    // 正文常被切成多个兄弟块(分节/分段容器):得分接近时上提到公共父级,
    // 否则把得分够高的兄弟块和长文本低链接密度的段落一并收入。
    if (top) {
      const best = top as Element;
      const parent = best.parentElement;
      if (parent && parent !== document.body && scores.has(parent) && finalScore(parent) >= bestScore * 0.66) {
        top = parent;
      } else if (parent) {
        const threshold = Math.max(10, bestScore * 0.2);
        const kept = Array.from(parent.children).filter((sib) => {
          if (sib === best) return true;
          if (isHidden(sib) || classWeight(sib) < 0) return false;
          if (scores.has(sib) && finalScore(sib) >= threshold) return true;
          if (sib.tagName === 'P') {
            const len = textOf(sib).length;
            const ld = linkDensity(sib);
            return (len > 80 && ld < 0.25) || (len > 0 && len <= 80 && ld === 0 && /[。.!?！？]\s*$/.test(textOf(sib)));
          }
          return false;
        });
        if (kept.length > 1) parts = kept;
      }
    }
  }
  if (!top) top = document.querySelector('main') || document.body;
  if (!top) return null;
  if (!parts.length) parts = [top];

  // 3) 白名单重建:只复制允许的标签与属性,跳过隐藏/噪声节点。
  const ALLOWED = new Set([
    'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
    'BLOCKQUOTE', 'PRE', 'CODE', 'KBD', 'SAMP', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH',
    'TD', 'CAPTION', 'FIGURE', 'FIGCAPTION', 'IMG', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'S',
    'DEL', 'INS', 'MARK', 'SUB', 'SUP', 'SMALL', 'ABBR', 'Q', 'CITE', 'TIME', 'SPAN', 'DIV',
    'SECTION', 'ARTICLE', 'PICTURE',
  ]);
  const DROP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM',
    'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'NAV', 'ASIDE', 'FOOTER', 'HEADER', 'SVG',
    'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'DIALOG', 'LINK', 'META',
  ]);
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');

  const pickSrc = (img: Element): string => {
    const lazy =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('data-url') ||
      '';
    const cur = (img as HTMLImageElement).currentSrc || img.getAttribute('src') || '';
    // 懒加载占位常是 1x1 gif / data: 小图,优先 data-* 真实地址。
    if (lazy && (!cur || cur.startsWith('data:') || /blank|placeholder|loading|spacer/i.test(cur))) {
      return abs(lazy);
    }
    if (cur) return abs(cur);
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const first = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
    return first ? abs(first) : '';
  };

  const copy = (src: Element, dst: Element, depth: number) => {
    if (depth > 60) return;
    src.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        dst.appendChild(doc.createTextNode(child.textContent || ''));
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (DROP.has(tag)) return;
      if (isHidden(el)) return;
      // 容器级噪声(分享栏/推荐/评论)整块跳过;正文根自身不受此限。
      if (tag !== 'IMG' && classWeight(el) < 0 && linkDensity(el) > 0.3) return;
      if (/^(DIV|SECTION|UL|OL|TABLE)$/.test(tag) && classWeight(el) <= -25 && textOf(el).length < 300) return;

      if (tag === 'IMG') {
        const url = pickSrc(el);
        if (!url || (url.startsWith('data:') && url.length > 200000)) return;
        const w = (el as HTMLImageElement).naturalWidth || 0;
        const h = (el as HTMLImageElement).naturalHeight || 0;
        if (w > 0 && h > 0 && w * h < 400) return; // 追踪像素/小图标
        const img = doc.createElement('img');
        img.setAttribute('src', url);
        const alt = el.getAttribute('alt');
        if (alt) img.setAttribute('alt', alt);
        if (w > 0 && h > 0) {
          img.setAttribute('width', String(w));
          img.setAttribute('height', String(h));
        }
        dst.appendChild(img);
        return;
      }
      if (tag === 'PICTURE') {
        const inner = el.querySelector('img');
        if (inner) copy({childNodes: [inner]} as any, dst, depth + 1);
        return;
      }
      if (!ALLOWED.has(tag)) {
        // 未知/自定义元素:展开其内容。
        copy(el, dst, depth + 1);
        return;
      }
      const out = doc.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = abs(el.getAttribute('href') || '');
        if (/^(https?|mailto):/i.test(href)) out.setAttribute('href', href);
      } else if (tag === 'TD' || tag === 'TH') {
        const cs = el.getAttribute('colspan');
        const rs = el.getAttribute('rowspan');
        if (cs) out.setAttribute('colspan', cs);
        if (rs) out.setAttribute('rowspan', rs);
      } else if (tag === 'OL') {
        const st = el.getAttribute('start');
        if (st) out.setAttribute('start', st);
      } else if (tag === 'PRE' || tag === 'CODE') {
        const lang = (el.className && typeof el.className === 'string'
          ? el.className.match(/(?:lang|language)-([\w+#-]+)/)
          : null);
        if (lang) out.setAttribute('class', `language-${lang[1]}`);
      }
      if (tag === 'PRE') {
        // 代码块保留原始换行,不再逐层过滤。
        out.textContent = (el as HTMLElement).innerText || el.textContent || '';
        dst.appendChild(out);
        return;
      }
      copy(el, out, depth + 1);
      // 丢掉复制后为空的块(图片/换行除外)。
      if (!/^(BR|HR|TD|TH)$/.test(tag) && !out.textContent!.trim() && !out.querySelector('img')) return;
      dst.appendChild(out);
    });
  };
  // 单块:复制其子节点;多块:逐块整体复制(各自仍走噪声过滤)。
  if (parts.length === 1) copy(parts[0], root, 0);
  else copy({childNodes: parts} as any, root, 0);

  // 4) 元信息
  let title = meta('og:title', 'twitter:title') || document.title || '';
  const h1 = root.querySelector('h1') || document.querySelector('h1');
  const h1Text = textOf(h1);
  if (h1Text && h1Text.length >= 4 && (title.includes(h1Text) || !title)) title = h1Text;
  if (title === document.title) {
    // "文章标题 - 站点名" / "文章标题_站点名" 去掉站点后缀。
    const parts = title.split(/\s+[-|–—_]\s+|_/);
    if (parts.length > 1 && parts[0].length >= 6) title = parts[0];
  }
  title = title.trim();
  // 正文开头若重复标题则去掉。
  const firstHeading = root.querySelector('h1, h2');
  if (firstHeading && textOf(firstHeading) === title) firstHeading.remove();

  const authorEl = document.querySelector(
    '[rel="author"], [itemprop="author"], .author-name, .author, #js_name, .byline',
  );
  const byline = (meta('author', 'article:author', 'twitter:creator') || textOf(authorEl)).slice(0, 80);
  const timeEl = document.querySelector('time[datetime]');
  const published =
    meta('article:published_time', 'datePublished', 'pubdate', 'publishdate') ||
    (timeEl ? timeEl.getAttribute('datetime') || '' : '') ||
    textOf(document.querySelector('#publish_time, .publish-time, .post-time, .time'));

  return {
    title,
    byline,
    siteName: meta('og:site_name', 'application-name') || location.hostname,
    published: published.slice(0, 40),
    lang: document.documentElement.lang || '',
    dir: document.documentElement.dir || (document.body && document.body.dir) || '',
    contentHtml: root.innerHTML,
    textLength: textOf(root).length,
    pageUrl: location.href,
  };
};

const getDownloadDir = (): string => {
  try {
    const configured = (Application.instance?.settings?.object as any)?.downloadsPath;
    if (configured) return configured;
  } catch {
    // 忽略
  }
  return app.getPath('downloads');
};

const uniqueSavePath = (fileName: string): string => {
  const dir = getDownloadDir();
  let savePath = resolve(dir, fileName);
  let i = 1;
  while (existsSync(savePath)) {
    const {name, ext} = parsePath(fileName);
    savePath = resolve(dir, `${name} (${i})${ext}`);
    i++;
  }
  return savePath;
};

// Windows 文件名非法字符/保留名处理,长度截到 80。
const safeFileName = (title: string): string => {
  let name = (title || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = 'article';
  return name.slice(0, 80);
};

const sniffMime = (buf: Buffer, header: string): string => {
  const h = (header || '').split(';')[0].trim().toLowerCase();
  if (h.startsWith('image/')) return h;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/^\s*(<\?xml|<svg)/i.test(buf.slice(0, 200).toString())) return 'image/svg+xml';
  return '';
};

// 带原网页 Referer/Cookie/UA 拉一张图,返回 data: URI;失败/非图片/超限返回 ''。
const fetchImageDataUri = (url: string, s: ReaderSession): Promise<string> =>
  new Promise((r) => {
    let req: Electron.ClientRequest;
    try {
      req = net.request(url);
    } catch {
      r('');
      return;
    }
    const done = (v: string) => {
      clearTimeout(timer);
      r(v);
    };
    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
        // 忽略
      }
      r('');
    }, IMAGE_TIMEOUT_MS);
    try {
      if (s.referer) req.setHeader('Referer', s.referer);
      if (s.cookies) req.setHeader('Cookie', s.cookies);
      if (s.userAgent) req.setHeader('User-Agent', s.userAgent);
    } catch {
      // 忽略
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('response', (response) => {
      if (response.statusCode >= 400) {
        done('');
        return;
      }
      const ct = String(response.headers['content-type'] || '');
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          try {
            req.abort();
          } catch {
            // 忽略
          }
          done('');
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = sniffMime(buf, ct);
        done(mime ? `data:${mime};base64,${buf.toString('base64')}` : '');
      });
      response.on('error', () => done(''));
    });
    req.on('error', () => done(''));
    req.end();
  });

// 快捷菜单「阅读模式」入口:在原网页提取正文 + 取防盗链头 → 暂存 → 开新标签页。
export const enterReaderMode = async (webContents: Electron.WebContents) => {
  const t = getMainTranslator(Application.instance.settings?.object?.language);
  let article: ReaderArticle | null = null;
  try {
    article = await webContents.executeJavaScript(
      `(${extractArticle.toString()})()`,
      true,
    );
  } catch (e) {
    console.error('[reader] extract failed:', e);
    showPageToast(webContents, t('rdExtractFailed'));
    return;
  }
  if (
    !article ||
    typeof article.contentHtml !== 'string' ||
    (article.textLength || 0) < MIN_TEXT_LENGTH
  ) {
    showPageToast(webContents, t('rdNoArticle'));
    return;
  }
  if (article.contentHtml.length > MAX_CONTENT_CHARS) {
    article.contentHtml = article.contentHtml.slice(0, MAX_CONTENT_CHARS);
  }

  let cookies = '';
  try {
    const list = await webContents.session.cookies.get({url: article.pageUrl});
    cookies = list.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    // 忽略:多数防盗链只查 Referer
  }
  let userAgent = '';
  try {
    userAgent = webContents.userAgent || '';
  } catch {
    // 忽略
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  readerCache.set(id, {article, referer: article.pageUrl, cookies, userAgent});
  // 阅读页刷新/保存都要用到会话,留 6 小时;超量时淘汰最早的。
  setTimeout(() => readerCache.delete(id), 6 * 60 * 60 * 1000);
  if (readerCache.size > 30) {
    const oldest = readerCache.keys().next().value;
    if (oldest) readerCache.delete(oldest);
  }

  const appWindow = Application.instance.windows.current;
  if (!appWindow) return;
  try {
    appWindow.viewManager.create(
      {url: getWebUIURL('reader') + `?id=${id}`, active: true} as any,
      true,
    );
  } catch (e) {
    console.error('[reader] create tab failed:', e);
    showPageToast(webContents, t('rdOpenFailed'));
  }
};

export const setupReaderModeIPC = () => {
  if (registered) return;
  registered = true;

  ipcMain.handle('reader-get', (_e, id: string): ReaderArticle | null => {
    const s = typeof id === 'string' ? readerCache.get(id) : undefined;
    return s ? s.article : null;
  });

  // 把正文中的远程图片换成 data: URI(并发 4,总量封顶),供离线 HTML 内联。
  ipcMain.handle(
    'reader-inline-images',
    async (_e, payload: {id: string; urls: string[]}) => {
      const s = payload && typeof payload.id === 'string' ? readerCache.get(payload.id) : undefined;
      if (!s) return {};
      const urls = Array.from(
        new Set((Array.isArray(payload.urls) ? payload.urls : []).filter(
          (u) => typeof u === 'string' && /^https?:\/\//i.test(u),
        )),
      ).slice(0, 300);
      const out: Record<string, string> = {};
      let total = 0;
      let next = 0;
      const worker = async () => {
        while (next < urls.length && total < MAX_TOTAL_IMAGE_BYTES) {
          const url = urls[next++];
          const data = await fetchImageDataUri(url, s);
          if (!data) continue;
          total += data.length;
          if (total <= MAX_TOTAL_IMAGE_BYTES) out[url] = data;
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return out;
    },
  );

  // 一键保存:直接写入下载目录(同名自动加序号),返回保存路径。
  ipcMain.handle(
    'reader-save',
    async (_e, payload: {title: string; format: 'html' | 'md'; content: string}) => {
      const format = payload?.format === 'md' ? 'md' : 'html';
      if (typeof payload?.content !== 'string' || !payload.content) {
        return {ok: false, error: 'empty'};
      }
      try {
        const savePath = uniqueSavePath(`${safeFileName(payload.title)}.${format}`);
        await fsp.writeFile(savePath, payload.content, 'utf8');
        savedPaths.add(savePath);
        return {ok: true, path: savePath};
      } catch (err) {
        console.error('[reader] save failed:', err);
        return {ok: false, error: String((err as Error)?.message || err)};
      }
    },
  );

  ipcMain.handle('reader-show-in-folder', (_e, path: string) => {
    if (typeof path !== 'string' || !savedPaths.has(path)) return false;
    shell.showItemInFolder(path);
    return true;
  });
};
