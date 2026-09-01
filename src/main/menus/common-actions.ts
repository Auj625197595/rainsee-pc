import { extname } from 'path';
import { dialog, clipboard } from 'electron';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import { showPrintPreview } from '../print-preview';

export const saveAs = async () => {
  const {
    title,
    webContents,
  } = Application.instance.windows.current.viewManager.selected;

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: title,
    filters: [
      { name: 'Webpage, Complete', extensions: ['html', 'htm'] },
      { name: 'Webpage, HTML Only', extensions: ['htm', 'html'] },
    ],
  });

  if (canceled) return;

  const ext = extname(filePath);

  webContents.savePage(filePath, ext === '.htm' ? 'HTMLOnly' : 'HTMLComplete');
};

// 复制网页为 Markdown:在页面上下文中把选区(若无选区则整页正文)转换为
// Markdown 文本,再写入系统剪贴板。转换器为自包含实现,无第三方依赖,运行在
// 渲染后的 DOM 上,因此能拿到动态内容。
export const copyPageAsMarkdown = async () => {
  const { viewManager } = Application.instance.windows.current;
  const view = viewManager.selected;
  if (!view) return;
  const { webContents } = view;
  const t = getMainTranslator(
    Application.instance.settings?.object?.language,
  );

  // 该函数被序列化后注入页面执行,内部不能引用外部作用域变量。
  const converter = function () {
    const baseURI = document.baseURI;

    const absUrl = (href: string): string => {
      try {
        return new URL(href, baseURI).href;
      } catch {
        return href || '';
      }
    };

    const SKIP = new Set([
      'SCRIPT',
      'STYLE',
      'NOSCRIPT',
      'IFRAME',
      'CANVAS',
      'SVG',
      'HEAD',
      'TEMPLATE',
      'OBJECT',
      'EMBED',
    ]);

    const isHidden = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur) {
        const style = window.getComputedStyle(cur as HTMLElement);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };

    const escapeText = (text: string): string =>
      text.replace(/([\\`*_{}\[\]()#+\-.!>])/g, '\\$1');

    const collapse = (text: string): string => text.replace(/\s+/g, ' ');

    // 行内节点 -> Markdown 字符串
    const inline = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeText(collapse(node.textContent || ''));
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as HTMLElement;
      if (SKIP.has(el.tagName) || isHidden(el)) return '';

      const tag = el.tagName;
      const inner = (): string =>
        Array.from(el.childNodes).map(inline).join('');

      switch (tag) {
        case 'BR':
          return '  \n';
        case 'STRONG':
        case 'B': {
          const t = inner().trim();
          return t ? `**${t}**` : '';
        }
        case 'EM':
        case 'I': {
          const t = inner().trim();
          return t ? `*${t}*` : '';
        }
        case 'DEL':
        case 'S':
        case 'STRIKE': {
          const t = inner().trim();
          return t ? `~~${t}~~` : '';
        }
        case 'CODE': {
          const t = el.textContent || '';
          return t ? '`' + t.replace(/`/g, '\\`') + '`' : '';
        }
        case 'A': {
          const t = inner().trim();
          const href = el.getAttribute('href');
          if (!href || href.startsWith('javascript:')) return t;
          return t ? `[${t}](${absUrl(href)})` : '';
        }
        case 'IMG': {
          const src = el.getAttribute('src') || el.getAttribute('data-src');
          if (!src) return '';
          const alt = (el.getAttribute('alt') || '').replace(/\]/g, '');
          return `![${alt}](${absUrl(src)})`;
        }
        default:
          return inner();
      }
    };

    const out: string[] = [];

    // 块级节点 -> Markdown 行,push 到 out
    const block = (node: Node, listPrefix = ''): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = collapse(node.textContent || '').trim();
        if (t) out.push(escapeText(t));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;
      if (SKIP.has(el.tagName) || isHidden(el)) return;

      const tag = el.tagName;

      switch (tag) {
        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6': {
          const level = Number(tag[1]);
          const t = Array.from(el.childNodes).map(inline).join('').trim();
          if (t) out.push('#'.repeat(level) + ' ' + t);
          return;
        }
        case 'P':
        case 'SECTION': {
          const t = Array.from(el.childNodes).map(inline).join('').trim();
          if (t) out.push(t);
          return;
        }
        case 'FIGURE': {
          const parts = Array.from(el.childNodes)
            .map((child) => {
              if (
                child.nodeType === Node.ELEMENT_NODE &&
                (child as Element).tagName === 'FIGCAPTION'
              ) {
                const caption = Array.from(child.childNodes).map(inline).join('').trim();
                return caption ? `*${caption}*` : '';
              }
              return inline(child);
            })
            .filter(Boolean);
          if (parts.length) out.push(parts.join('\n'));
          return;
        }
        case 'FIGCAPTION': {
          const t = Array.from(el.childNodes).map(inline).join('').trim();
          if (t) out.push(`*${t}*`);
          return;
        }
        case 'BLOCKQUOTE': {
          const buf: string[] = [];
          const saved = out.splice(0, out.length);
          Array.from(el.childNodes).forEach((c) => block(c));
          buf.push(...out.splice(0, out.length));
          out.push(...saved);
          const quoted = buf
            .join('\n\n')
            .split('\n')
            .map((l) => '> ' + l)
            .join('\n');
          if (quoted.trim()) out.push(quoted);
          return;
        }
        case 'PRE': {
          const codeEl = el.querySelector('code');
          const text = (codeEl || el).textContent || '';
          const langMatch = (codeEl?.className || '').match(
            /language-([\w-]+)/,
          );
          const lang = langMatch ? langMatch[1] : '';
          out.push('```' + lang + '\n' + text.replace(/\n$/, '') + '\n```');
          return;
        }
        case 'UL':
        case 'OL': {
          const ordered = tag === 'OL';
          let idx = 1;
          Array.from(el.children).forEach((li) => {
            if (li.tagName !== 'LI') return;
            const marker = ordered ? `${idx}. ` : '- ';
            const indent = listPrefix + ' '.repeat(marker.length);
            // 收集本 li 的行内内容与嵌套子列表
            const inlineParts: string[] = [];
            const nested: string[] = [];
            Array.from(li.childNodes).forEach((c) => {
              if (
                c.nodeType === Node.ELEMENT_NODE &&
                ((c as Element).tagName === 'UL' ||
                  (c as Element).tagName === 'OL')
              ) {
                const saved = out.splice(0, out.length);
                block(c, indent);
                nested.push(...out.splice(0, out.length));
                out.push(...saved);
              } else {
                inlineParts.push(inline(c));
              }
            });
            const text = inlineParts.join('').trim();
            out.push(listPrefix + marker + text);
            if (nested.length) out.push(nested.join('\n'));
            idx++;
          });
          return;
        }
        case 'TABLE': {
          const rows = Array.from(el.querySelectorAll('tr'));
          if (!rows.length) return;
          const grid = rows.map((tr) =>
            Array.from(tr.querySelectorAll('th,td')).map((cell) =>
              Array.from(cell.childNodes)
                .map(inline)
                .join('')
                .trim()
                .replace(/\|/g, '\\|')
                .replace(/\n/g, ' '),
            ),
          );
          const cols = Math.max(...grid.map((r) => r.length));
          const norm = (r: string[]) => {
            const c = r.slice();
            while (c.length < cols) c.push('');
            return '| ' + c.join(' | ') + ' |';
          };
          const lines = [norm(grid[0])];
          lines.push('| ' + Array(cols).fill('---').join(' | ') + ' |');
          for (let i = 1; i < grid.length; i++) lines.push(norm(grid[i]));
          out.push(lines.join('\n'));
          return;
        }
        case 'HR':
          out.push('---');
          return;
        case 'DIV':
          if (el.id === 'js_content' || el.classList.contains('rich_media_content')) {
            Array.from(el.childNodes).forEach((c) => block(c, listPrefix));
            return;
          }
          {
            const t = inline(el).trim();
            if (t && el.children.length === 0) {
              out.push(t);
              return;
            }
            Array.from(el.childNodes).forEach((c) => block(c, listPrefix));
            return;
          }
        case 'IMG':
        case 'A':
        case 'CODE':
        case 'STRONG':
        case 'B':
        case 'EM':
        case 'I':
        case 'SPAN': {
          const t = inline(el).trim();
          if (t) out.push(t);
          return;
        }
        default: {
          // 容器:递归子节点
          Array.from(el.childNodes).forEach((c) => block(c, listPrefix));
          return;
        }
      }
    };

    const textLength = (node: Node | null): number =>
      collapse((node?.textContent || '').replace(/\u200b/g, ' ')).trim().length;

    const hasKeyword = (value: string, keywords: string[]): boolean =>
      keywords.some((keyword) => value.includes(keyword));

    const isBoilerplate = (el: Element): boolean => {
      const attr = `${el.id || ''} ${el.className || ''} ${el.getAttribute('role') || ''}`.toLowerCase();
      return hasKeyword(attr, [
        'nav',
        'menu',
        'toolbar',
        'header',
        'footer',
        'sidebar',
        'aside',
        'pager',
        'pagination',
        'breadcrumb',
        'recommend',
        'related',
        'promo',
        'advert',
        'ad-',
        'ads',
        'comment-menu',
        'user-card',
        'quick-access',
        'category-list',
        'expression',
        'topic-select',
        'editor',
        'code-mirror',
        'cm-',
        'submit',
        'rich_media_tool',
        'original_area',
        'wx_profile',
        'meta_content',
        'rich_media_area_primary_inner',
        'global_dialog',
        'qr_code',
        'reward',
      ]);
    };

    const isReadableNode = (el: Element): boolean => {
      if (SKIP.has(el.tagName) || isHidden(el) || isBoilerplate(el)) return false;
      if (el.closest('nav,header,footer,aside,form')) return false;
      const text = textLength(el);
      if (text < 20) return false;
      const rect = (el as HTMLElement).getBoundingClientRect?.();
      if (rect && rect.width === 0 && rect.height === 0) return false;
      return true;
    };

    const withReadableContainer = (el: Element): Element => {
      const item = el.closest('li.content-item, article, .comment-item, .post-item');
      if (item && isReadableNode(item)) return item;
      return el;
    };

    const dedupeNested = (nodes: Element[]): Element[] => {
      const result: Element[] = [];
      nodes.forEach((node) => {
        if (result.some((existing) => existing === node || existing.contains(node))) {
          return;
        }
        for (let i = result.length - 1; i >= 0; i--) {
          if (node.contains(result[i])) result.splice(i, 1);
        }
        result.push(node);
      });
      return result;
    };

    const commonAncestor = (a: Node | null, b: Node | null): Element | null => {
      if (!a || !b) return null;
      let cur: Node | null = a.nodeType === Node.ELEMENT_NODE ? a : a.parentElement;
      while (cur) {
        if (cur instanceof Element && cur.contains(b)) return cur;
        cur = cur.parentNode;
      }
      return null;
    };

    const collectContentNodes = (): Element[] => {
      const selector = [
        '#js_content',
        '.rich_media_content',
        '.rich_media_wrp',
        '.rich_media_area_primary',
        'li.content-item',
        '.comments > li',
        '.comment-item',
        'article.post-content',
        '.post-content',
        '.markdown-body',
        '.article-content',
        '.entry-content',
        '.post-body',
        '.topic-content',
        '.comment-content',
        '.message-content',
        'article',
      ].join(',');
      const nodes = Array.from(document.querySelectorAll(selector))
        .map(withReadableContainer)
        .filter(isReadableNode);
      return dedupeNested(nodes);
    };

    const isWechatArticle = (): boolean => (
      /mp\.weixin\.qq\.com$/i.test(location.hostname) ||
      Boolean(
        document.querySelector(
          '#activity-name, #js_name, #js_content, .rich_media_title, .rich_media_content',
        ),
      )
    );

    const buildWechatRoot = (): Element | null => {
      const title =
        document.querySelector('#activity-name') ||
        document.querySelector('.rich_media_title') ||
        document.querySelector('h1');
      const author =
        document.querySelector('#js_name') ||
        document.querySelector('.rich_media_meta_text');
      const publishTime =
        document.querySelector('#publish_time') ||
        document.querySelector('.rich_media_meta.rich_media_meta_nickname');
      const content =
        document.querySelector('#js_content') ||
        document.querySelector('.rich_media_content');

      if (!content) return null;

      const wrap = document.createElement('div');
      if (title) {
        const h1 = document.createElement('h1');
        h1.textContent = collapse(title.textContent || '').trim();
        if (h1.textContent) wrap.appendChild(h1);
      }

      const metaParts = [author?.textContent || '', publishTime?.textContent || '']
        .map((item) => collapse(item).trim())
        .filter(Boolean);
      if (metaParts.length) {
        const p = document.createElement('p');
        p.textContent = metaParts.join('  ');
        wrap.appendChild(p);
      }

      wrap.appendChild(content.cloneNode(true));
      return wrap;
    };

    const buildAutoRoot = (): Element | null => {
      if (isWechatArticle()) {
        const wechatRoot = buildWechatRoot();
        if (wechatRoot && textLength(wechatRoot) >= 20) return wechatRoot;
      }

      const titleNode = document.querySelector('h1');
      const contentNodes = collectContentNodes();

      if (contentNodes.length) {
        const wrap = document.createElement('div');
        if (titleNode && !contentNodes.some((node) => node.contains(titleNode))) {
          wrap.appendChild(titleNode.cloneNode(true));
        }
        contentNodes.forEach((node) => wrap.appendChild(node.cloneNode(true)));
        if (textLength(wrap) >= 20) return wrap;
      }

      const wideAnchor = titleNode && contentNodes.length
        ? commonAncestor(titleNode, contentNodes[contentNodes.length - 1])
        : contentNodes.length >= 2
          ? commonAncestor(contentNodes[0], contentNodes[contentNodes.length - 1])
          : null;
      if (
        wideAnchor &&
        wideAnchor !== document.body &&
        wideAnchor !== document.documentElement &&
        textLength(wideAnchor) >= 20
      ) {
        return wideAnchor;
      }

      const candidates = Array.from(
        document.querySelectorAll('main, article, section, [role="main"], .content, .content-area, .main, .container'),
      ).filter(isReadableNode);

      let best: Element | null = null;
      let bestScore = -Infinity;
      candidates.forEach((el) => {
        const attr = `${el.id || ''} ${el.className || ''}`.toLowerCase();
        const len = textLength(el);
        const paragraphs = el.querySelectorAll('p, li, pre, blockquote').length;
        const articles = el.querySelectorAll('article, .post-content').length;
        const links = el.querySelectorAll('a').length;
        const headingBonus = titleNode && el.contains(titleNode) ? 120 : 0;
        const keywordBonus = hasKeyword(attr, [
          'content',
          'article',
          'post',
          'entry',
          'thread',
          'topic',
          'discussion',
          'message',
          'main',
        ])
          ? 80
          : 0;
        const score =
          Math.min(len, 4000) +
          paragraphs * 25 +
          articles * 90 +
          headingBonus +
          keywordBonus -
          links * 8 -
          (el.tagName === 'BODY' ? 1000 : 0);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      });

      return best || document.querySelector('main') || document.querySelector('article') || document.body;
    };

    // 优先使用选区,否则整页正文
    const selection = window.getSelection();
    let root: Element | null = null;
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const frag = range.cloneContents();
      const wrap = document.createElement('div');
      wrap.appendChild(frag);
      root = wrap;
    } else {
      root = buildAutoRoot();
    }

    if (!root) return '';

    Array.from(root.childNodes).forEach((c) => block(c));

    const title =
      (document.querySelector('h1')?.textContent || document.title || '').trim();
    let body = out
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 整页转换时附加标题与来源链接
    if (
      title &&
      (!selection || selection.isCollapsed) &&
      !body.startsWith('# ')
    ) {
      body = `# ${title}\n\n${body}`;
    }
    return body;
  };

  try {
    const markdown: string = await webContents.executeJavaScript(
      `(${converter.toString()})()`,
      true,
    );
    if (markdown && markdown.trim()) {
      clipboard.writeText(markdown);
      showPageToast(webContents, t('ctxCopiedAsMarkdown'));
    } else {
      showPageToast(webContents, t('ctxNothingToCopy'));
    }
  } catch (e) {
    console.error('[copyPageAsMarkdown] failed:', e);
    showPageToast(webContents, t('stCopyFailed'));
  }
};

// 在页面内注入一个短暂的 toast 提示(自包含,无第三方依赖)。
export const showPageToast = (
  webContents: Electron.WebContents,
  message: string,
) => {
  const toast = function (msg: string) {
    const ID = '__rs_md_toast__';
    const old = document.getElementById(ID);
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = ID;
    el.textContent = msg;
    el.setAttribute(
      'style',
      [
        'position:fixed',
        'left:50%',
        'bottom:48px',
        'transform:translateX(-50%) translateY(10px)',
        'z-index:2147483647',
        'max-width:80vw',
        'padding:10px 18px',
        'background:rgba(32,33,36,0.92)',
        'color:#fff',
        'font-size:13px',
        'line-height:1.4',
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        'border-radius:8px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.28)',
        'opacity:0',
        'pointer-events:none',
        'transition:opacity .2s ease,transform .2s ease',
      ].join(';'),
    );
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(function () {
        el.remove();
      }, 220);
    }, 1800);
  };

  webContents
    .executeJavaScript(`(${toast.toString()})(${JSON.stringify(message)})`, true)
    .catch(() => {
      /* 页面可能不允许执行,忽略 */
    });
};

export const viewSource = async () => {
  const { viewManager } = Application.instance.windows.current;

  viewManager.create(
    {
      url: `view-source:${viewManager.selected.url}`,
      active: true,
    },
    true,
  );
};

export const printPage = async () => {
  const { viewManager } = Application.instance.windows.current;
  const view = viewManager.selected;
  if (!view) return;

  try {
    const pdf = await view.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    showPrintPreview(view.webContents, pdf);
  } catch (error) {
    console.error('[print-preview] failed to create PDF:', error);
    // 预览生成失败时仍保证用户能完成打印。
    view.webContents.print();
  }
};
