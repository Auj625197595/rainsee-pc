// 阅读页工具:正文净化(信任边界)、Markdown 转换、离线 HTML 拼装。

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

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'sans' | 'serif';

export interface ReaderPrefs {
  theme: ReaderTheme | 'auto';
  font: ReaderFont;
  fontSize: number;
  width: number;
  format: 'html' | 'md';
}

export const THEME_COLORS: Record<ReaderTheme, {bg: string; text: string; dim: string; link: string; border: string; code: string}> = {
  light: {bg: '#ffffff', text: '#1f2328', dim: '#6b7280', link: '#2563eb', border: '#e5e7eb', code: '#f3f4f6'},
  sepia: {bg: '#f6efe1', text: '#3b3226', dim: '#7a6b55', link: '#9a5b13', border: '#e3d7bf', code: '#ece2cd'},
  dark: {bg: '#1b1c1f', text: '#d9d9dc', dim: '#8b8c92', link: '#7aa7ff', border: '#2e3036', code: '#26282d'},
};

export const FONT_STACKS: Record<ReaderFont, string> = {
  sans: `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif`,
  serif: `Georgia,'Noto Serif SC','Source Han Serif SC','Songti SC',SimSun,serif`,
};

// ── 净化 ────────────────────────────────────────────────────────────────
// 正文来自不可信网页,而阅读页是带 bridge 的特权页:只放行白名单标签/属性,
// 其余标签展开(保留文本)或整块丢弃。DOMParser 文档是惰性的,解析时不执行脚本/不加载资源。

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'kbd', 'samp', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th',
  'td', 'caption', 'figure', 'figcaption', 'img', 'a', 'strong', 'b', 'em', 'i', 'u', 's',
  'del', 'ins', 'mark', 'sub', 'sup', 'small', 'abbr', 'q', 'cite', 'time', 'span', 'div',
  'section', 'article',
]);
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'canvas', 'video', 'audio',
  'link', 'meta', 'base', 'title', 'head', 'dialog', 'portal',
]);
const SAFE_IMG = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,)/i;
const SAFE_HREF = /^(https?:|mailto:)/i;
const NUM = /^\d{1,4}$/;

export const sanitizeArticleHtml = (html: string): DocumentFragment => {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const frag = document.createDocumentFragment();

  const walk = (from: Node, to: Node) => {
    from.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(child.textContent || ''));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) return;
      if (!ALLOWED_TAGS.has(tag)) {
        walk(el, to);
        return;
      }
      const out = document.createElement(tag);
      if (tag === 'a') {
        const href = (el.getAttribute('href') || '').trim();
        if (SAFE_HREF.test(href)) {
          out.setAttribute('href', href);
          out.setAttribute('target', '_blank');
          out.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (tag === 'img') {
        const s = (el.getAttribute('src') || '').trim();
        if (!SAFE_IMG.test(s)) return;
        out.setAttribute('src', s);
        out.setAttribute('loading', 'lazy');
        out.setAttribute('referrerpolicy', 'no-referrer');
        const alt = el.getAttribute('alt');
        if (alt) out.setAttribute('alt', alt.slice(0, 300));
        for (const k of ['width', 'height']) {
          const v = el.getAttribute(k);
          if (v && NUM.test(v)) out.setAttribute(k, v);
        }
      } else if (tag === 'td' || tag === 'th') {
        for (const k of ['colspan', 'rowspan']) {
          const v = el.getAttribute(k);
          if (v && NUM.test(v)) out.setAttribute(k, v);
        }
      } else if (tag === 'ol') {
        const v = el.getAttribute('start');
        if (v && NUM.test(v)) out.setAttribute('start', v);
      } else if (tag === 'pre' || tag === 'code') {
        const m = (el.getAttribute('class') || '').match(/^language-([\w+#-]{1,30})$/);
        if (m) out.setAttribute('class', `language-${m[1]}`);
      }
      walk(el, out);
      to.appendChild(out);
    });
  };
  walk(src, frag);
  return frag;
};

// ── 阅读时长 ──────────────────────────────────────────────────────────────
export const readingMinutes = (text: string): number => {
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) || []).length;
  const words = text.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, ' ')
    .split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
};

// ── Markdown ─────────────────────────────────────────────────────────────
const mdEscape = (s: string) => s.replace(/([\\`*_[\]])/g, '\\$1');

export const htmlToMarkdown = (root: Node): string => {
  const inline = (node: Node): string => {
    let out = '';
    node.childNodes.forEach((c) => {
      out += render(c, 0);
    });
    return out;
  };

  const list = (el: Element, depth: number, ordered: boolean): string => {
    let i = Number(el.getAttribute('start')) || 1;
    let out = '';
    Array.from(el.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      const pad = '  '.repeat(depth);
      const marker = ordered ? `${i++}.` : '-';
      let text = '';
      let nested = '';
      li.childNodes.forEach((c) => {
        if (c.nodeType === 1 && /^(UL|OL)$/.test((c as Element).tagName)) {
          nested += list(c as Element, depth + 1, (c as Element).tagName === 'OL');
        } else {
          text += render(c, depth + 1);
        }
      });
      out += `${pad}${marker} ${text.replace(/\n{2,}/g, '\n').trim()}\n${nested}`;
    });
    return depth === 0 ? `\n\n${out}\n` : out;
  };

  const table = (el: Element): string => {
    const rows = Array.from(el.querySelectorAll('tr'));
    if (!rows.length) return '';
    const cells = rows.map((r) =>
      Array.from(r.children).map((c) => inline(c).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()),
    );
    const cols = Math.max(...cells.map((r) => r.length));
    const line = (r: string[]) => `| ${Array.from({length: cols}, (_, i) => r[i] || '').join(' | ')} |`;
    return `\n\n${line(cells[0])}\n| ${Array(cols).fill('---').join(' | ')} |\n${cells.slice(1).map(line).join('\n')}\n\n`;
  };

  const render = (node: Node, depth: number): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return mdEscape((node.textContent || '').replace(/\s+/g, ' '));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName;
    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        return `\n\n${'#'.repeat(Number(tag[1]))} ${inline(el).trim()}\n\n`;
      case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'FIGURE':
        return `\n\n${inline(el).trim()}\n\n`;
      case 'FIGCAPTION': case 'CAPTION':
        return `\n\n*${inline(el).trim()}*\n\n`;
      case 'BR':
        return '  \n';
      case 'HR':
        return '\n\n---\n\n';
      case 'STRONG': case 'B': {
        const t = inline(el).trim();
        return t ? `**${t}**` : '';
      }
      case 'EM': case 'I': case 'CITE': {
        const t = inline(el).trim();
        return t ? `*${t}*` : '';
      }
      case 'DEL': case 'S': {
        const t = inline(el).trim();
        return t ? `~~${t}~~` : '';
      }
      case 'CODE':
        return `\`${(el.textContent || '').replace(/`/g, 'ˋ')}\``;
      case 'PRE': {
        const lang = ((el.getAttribute('class') || '').match(/language-([\w+#-]+)/) || [])[1] ||
          ((el.querySelector('code')?.getAttribute('class') || '').match(/language-([\w+#-]+)/) || [])[1] || '';
        return `\n\n\`\`\`${lang}\n${(el.textContent || '').replace(/\n+$/, '')}\n\`\`\`\n\n`;
      }
      case 'BLOCKQUOTE': {
        const t = inline(el).trim().split('\n').map((l) => `> ${l}`).join('\n');
        return `\n\n${t}\n\n`;
      }
      case 'A': {
        const t = inline(el).trim();
        const href = el.getAttribute('href');
        return href && t ? `[${t}](${href})` : t;
      }
      case 'IMG': {
        const s = el.getAttribute('src') || '';
        // data: 图片写进 md 体积过大且多数编辑器不显示,只保留远程地址。
        if (!s || s.startsWith('data:')) return '';
        return `\n\n![${mdEscape(el.getAttribute('alt') || '')}](${s})\n\n`;
      }
      case 'UL': return list(el, 0, false);
      case 'OL': return list(el, 0, true);
      case 'TABLE': return table(el);
      default:
        return inline(el);
    }
  };

  return inline(root).replace(/[ \t]*\n[ \t]*\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n').trim();
};

// ── 离线 HTML ───────────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const buildOfflineHtml = (
  a: ReaderArticle,
  bodyHtml: string,
  theme: ReaderTheme,
  prefs: ReaderPrefs,
  metaLine: string,
  sourceLabel: string,
): string => {
  const c = THEME_COLORS[theme];
  const lang = esc(a.lang || 'zh-CN');
  const dir = a.dir === 'rtl' ? ' dir="rtl"' : '';
  return `<!doctype html>
<html lang="${lang}"${dir}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'">
<title>${esc(a.title)}</title>
<style>
html{background:${c.bg};}
body{margin:0 auto;max-width:${prefs.width}px;padding:48px 24px 96px;color:${c.text};background:${c.bg};
font-family:${FONT_STACKS[prefs.font]};font-size:${prefs.fontSize}px;line-height:1.8;word-wrap:break-word;}
h1.title{font-size:1.75em;line-height:1.35;margin:0 0 12px;}
.meta{color:${c.dim};font-size:.8em;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid ${c.border};}
.meta a{color:${c.dim};}
a{color:${c.link};}
img{max-width:100%;height:auto;display:block;margin:1em auto;border-radius:4px;}
pre{background:${c.code};padding:12px 16px;border-radius:6px;overflow:auto;font-size:.85em;line-height:1.6;white-space:pre-wrap;}
code{background:${c.code};padding:1px 5px;border-radius:4px;font-size:.9em;}
pre code{background:none;padding:0;}
blockquote{margin:1em 0;padding:4px 16px;border-left:4px solid ${c.border};color:${c.dim};}
table{border-collapse:collapse;width:100%;font-size:.9em;}
th,td{border:1px solid ${c.border};padding:6px 10px;}
figcaption{color:${c.dim};font-size:.85em;text-align:center;}
hr{border:none;border-top:1px solid ${c.border};}
</style>
</head>
<body>
<h1 class="title">${esc(a.title)}</h1>
<div class="meta">${esc(metaLine)}${metaLine ? ' · ' : ''}<a href="${esc(a.pageUrl)}">${esc(sourceLabel)}</a></div>
<article>
${bodyHtml}
</article>
</body>
</html>
`;
};
