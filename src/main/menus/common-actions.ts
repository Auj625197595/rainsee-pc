import { extname } from 'path';
import { dialog, clipboard } from 'electron';
import { pathToFileURL } from 'url';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import { showPrintPreview } from '../print-preview';

// 通过浏览器内的文件选择器打开存档,不要求安装器声明系统文件关联。
export const openLocalWebArchive = async () => {
  const window = Application.instance.windows.current;
  if (!window) return;

  const { canceled, filePaths } = await dialog.showOpenDialog(window.win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '网页文件', extensions: ['mhtml', 'mht', 'html', 'htm'] },
    ],
  });
  if (canceled || !filePaths.length) return;

  filePaths.forEach((filePath, index) => {
    window.viewManager.create({
      url: pathToFileURL(filePath).href,
      active: index === filePaths.length - 1,
    });
  });
};

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
      { name: 'Webpage, Single File (MHTML)', extensions: ['mhtml', 'mht'] },
    ],
  });

  if (canceled) return;

  const ext = extname(filePath).toLowerCase();

  const saveType =
    ext === '.mhtml' || ext === '.mht'
      ? 'MHTML'
      : ext === '.htm'
        ? 'HTMLOnly'
        : 'HTMLComplete';
  webContents.savePage(filePath, saveType);
};

// 飞书 docx/wiki 为虚拟滚动渲染,DOM 中仅保留可视区域附近的块,
// 一次性提取拿不到完整正文;注入后在页面内从头到尾滚动,按块收集并转为 Markdown。
// 该函数被序列化后注入页面执行,内部不能引用外部作用域变量。
const feishuDocCollector = async function (
  allowSelection: boolean,
): Promise<string | null> {
  try {
    const host = location.hostname.toLowerCase();
    if (
      !/(^|\.)feishu\.cn$/.test(host) &&
      !/(^|\.)larksuite\.com$/.test(host) &&
      !/(^|\.)larkoffice\.com$/.test(host)
    ) {
      return null;
    }
    // 有选区时交给通用选区转换逻辑
    const sel = allowSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount && !sel.isCollapsed) return null;

    const wrapper = document.querySelector(
      '.render-unit-wrapper',
    ) as HTMLElement | null;
    if (!wrapper || !wrapper.querySelector('.block[data-block-id]')) {
      return null;
    }

    const ZW = /[\u200b-\u200d\u2060\ufeff]/g;
    const clean = (t: string): string =>
      (t || '').replace(ZW, '').replace(/[ \t]+/g, ' ');
    const sleep = (ms: number): Promise<void> =>
      new Promise((r) => setTimeout(r, ms));

    // 文档标题:优先取正文内的 h1,否则用页面标题去掉后缀
    const cleanTitle = (t: string): string =>
      clean(t).replace(/\s+/g, ' ').trim();
    const h1 = document.querySelector('.page-block-header h1');
    let title = cleanTitle((h1 && h1.textContent) || '');
    if (!title) {
      title = cleanTitle(document.title || '').replace(
        /\s*[-\u2013\u2014]\s*(飞书云文档|飞书|Lark Docs|Lark|Feishu)\s*$/i,
        '',
      );
    }

    // 块直属的文本行(排除嵌套在子块内的行,以及标题自动编号)
    const ownLines = (el: Element): Element[] =>
      Array.from(el.querySelectorAll('.ace-line')).filter((l) => {
        const owner = l.parentElement
          ? (l.parentElement.closest('.block[data-block-id]') as Element | null)
          : null;
        return !owner || owner === el;
      });

    const inline = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return clean(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as HTMLElement;
      const tag = el.tagName;
      if (
        tag === 'SCRIPT' ||
        tag === 'STYLE' ||
        tag === 'SVG' ||
        tag === 'BUTTON' ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA'
      ) {
        return '';
      }
      if (tag === 'BR') return '\n';
      if (tag === 'IMG') {
        const src =
          el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (!src || !/^(https?:|data:image)/i.test(src)) return '';
        const alt = clean(el.getAttribute('alt') || '')
          .replace(/[\[\]]/g, '')
          .trim();
        return '![' + (alt || 'image') + '](' + src + ')';
      }
      if (tag === 'A') {
        const href = el.getAttribute('href') || '';
        const t = clean(el.textContent || '').trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            return '[' + t + '](' + new URL(href, location.href).href + ')';
          } catch {
            return '[' + t + '](' + href + ')';
          }
        }
        return t;
      }
      return Array.from(el.childNodes).map(inline).join('');
    };

    const lineText = (el: Element): string =>
      ownLines(el)
        .map((l) => inline(l).replace(/\s+$/g, ''))
        .filter((t) => t.trim())
        .join('\n');

    const indentOf = (el: Element): number => {
      const cls = typeof el.className === 'string' ? el.className : '';
      const m = cls.match(/indent-level-(\d+)/);
      if (m) return Math.max(0, Number(m[1]) - 1);
      const p = el.closest('[class*="indent-level-"]');
      const pm = p
        ? ((p.className || '') as string).match(/indent-level-(\d+)/)
        : null;
      return pm ? Math.max(0, Number(pm[1]) - 1) : 0;
    };

    const listBody = (el: Element): string => {
      const content = el.querySelector('.list-content') || el;
      const lines = Array.from(content.querySelectorAll('.ace-line'))
        .map((l) => inline(l).replace(/\s+$/g, ''))
        .filter((t) => t.trim());
      if (lines.length) return lines.join('\n').replace(/\n/g, ' ');
      return clean((el as HTMLElement).innerText || '')
        .replace(/^[\u2022\u00b7]\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // 有序块序号(跨块按层级累加,遇普通块重置)
    const orderCounters: number[] = [];
    const resetOrder = (): void => {
      orderCounters.length = 0;
    };

    const convertBlock = (el: Element): string => {
      const type = (el.getAttribute('data-block-type') || '').toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';

      // 容器块:内容由子块单独输出
      if (
        type === 'page' ||
        type === 'view' ||
        type === 'grid' ||
        type === 'grid_column' ||
        cls.includes('docx-page-block')
      ) {
        return '';
      }

      const heading =
        type.match(/^heading([1-9])/) || cls.match(/docx-heading([1-9])-block/);
      if (heading) {
        resetOrder();
        const t = lineText(el).replace(/\s+/g, ' ').trim();
        return t ? '#'.repeat(Number(heading[1])) + ' ' + t : '';
      }

      if (type === 'code' || cls.includes('docx-code-block')) {
        resetOrder();
        const zone =
          el.querySelector('.code-block-zone-container') ||
          el.querySelector('[data-slate-editor="true"]') ||
          el;
        const lines = Array.from(zone.querySelectorAll('.ace-line'))
          .filter((l) => !l.closest('.code-block-header'))
          .map((l) => (l.textContent || '').replace(ZW, '').replace(/\s+$/, ''));
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const code = lines.join('\n');
        const fence = code.indexOf('```') >= 0 ? '````' : '```';
        return fence + '\n' + code + '\n' + fence;
      }

      if (type === 'image' || cls.includes('docx-image-block')) {
        resetOrder();
        const img = el.querySelector('img');
        const src = img
          ? img.getAttribute('src') || img.getAttribute('data-src') || ''
          : '';
        if (!src || !/^(https?:|data:image)/i.test(src)) return '';
        const alt =
          clean((img as HTMLElement).getAttribute('alt') || '')
            .replace(/[\[\]]/g, '')
            .trim() || 'image';
        return '![' + alt + '](' + src + ')';
      }

      if (type === 'bullet' || cls.includes('bullet-list')) {
        resetOrder();
        const body = listBody(el);
        return body ? '  '.repeat(indentOf(el)) + '- ' + body : '';
      }

      if (/^order/.test(type) || cls.includes('order-list')) {
        const level = indentOf(el);
        orderCounters.length = level + 1;
        orderCounters[level] = (orderCounters[level] || 0) + 1;
        const body = listBody(el);
        return body
          ? '  '.repeat(level) + orderCounters[level] + '. ' + body
          : '';
      }

      if (/^(task|todo)/.test(type) || cls.includes('docx-todo-block')) {
        resetOrder();
        const cb = el.querySelector('input[type="checkbox"]');
        const done = cb ? (cb as HTMLInputElement).checked : false;
        const body = lineText(el).replace(/\n/g, ' ').trim();
        return body
          ? '  '.repeat(indentOf(el)) + (done ? '- [x] ' : '- [ ] ') + body
          : '';
      }

      if (
        type === 'divider' ||
        type === 'hr' ||
        cls.includes('docx-divider-block')
      ) {
        resetOrder();
        return '---';
      }

      // 高亮块/引用块:整体作为引用输出,其子块由跳过规则去重
      if (
        type === 'callout' ||
        cls.includes('docx-callout-block') ||
        type === 'quote' ||
        type === 'quote_container' ||
        cls.includes('docx-quote-block')
      ) {
        resetOrder();
        const t = clean((el as HTMLElement).innerText || '').trim();
        return t
          ? t
              .split('\n')
              .map((l) => '> ' + l.trim())
              .join('\n')
          : '';
      }

      if (type === 'table' || cls.includes('docx-table-block')) {
        resetOrder();
        const table = el.querySelector('table');
        if (!table) {
          const t = clean((el as HTMLElement).innerText || '').trim();
          return t || '[表格]';
        }
        const rows = Array.from(table.querySelectorAll('tr'));
        if (!rows.length) return '[表格]';
        const grid = rows.map((tr) =>
          Array.from(tr.querySelectorAll('th,td')).map((cell) =>
            clean((cell as HTMLElement).innerText || '')
              .replace(/\|/g, '\\|')
              .replace(/\n/g, ' ')
              .trim(),
          ),
        );
        const cols = Math.max.apply(
          null,
          grid.map((r) => r.length),
        );
        const pad = (r: string[]): string => {
          const c = r.slice();
          while (c.length < cols) c.push('');
          return '| ' + c.join(' | ') + ' |';
        };
        const lines = [
          pad(grid[0]),
          '|' + Array(cols).fill(' --- ').join('|') + '|',
        ];
        for (let i = 1; i < grid.length; i++) lines.push(pad(grid[i]));
        return lines.join('\n');
      }

      if (
        /^(sheet|bitable|board|file|iframe|add_ons|jira|okr|wiki_catalog|mindnote|isv)/.test(
          type,
        )
      ) {
        resetOrder();
        return '[嵌入内容: ' + type + ']';
      }

      // 文本块及未知类型
      resetOrder();
      return lineText(el).trim();
    };

    // id -> 已收集的 markdown;同一块多次收集时保留更完整的内容
    // (虚拟滚动下代码行等可能延后挂载,首遍可能采到空/残缺内容)
    const seen: Record<string, string> = {};
    const orderedIds: string[] = [];
    const collect = (): void => {
      Array.from(wrapper.querySelectorAll('.block[data-block-id]')).forEach(
        (b) => {
          // data-block-id 为文档顺序的连续数字,优先用它作为 key,便于末尾排序
          const id =
            b.getAttribute('data-block-id') ||
            b.getAttribute('data-record-id') ||
            '';
          if (!id) return;
          // 预渲染副本先不收,等真实位置出现时再收
          if (b.closest('.bear-virtual-pre-renderer')) return;
          // 嵌套在引用/高亮/表格内的子块已由父块整体输出
          const owner = b.parentElement
            ? (b.parentElement.closest(
                '.block[data-block-id]',
              ) as Element | null)
            : null;
          if (owner) {
            const oType = (
              owner.getAttribute('data-block-type') || ''
            ).toLowerCase();
            const oCls =
              typeof owner.className === 'string' ? owner.className : '';
            if (
              oType === 'callout' ||
              oCls.includes('docx-callout-block') ||
              oType === 'quote' ||
              oType === 'quote_container' ||
              oCls.includes('docx-quote-block') ||
              oType === 'table' ||
              oCls.includes('docx-table-block')
            ) {
              return;
            }
          }
          const md = convertBlock(b);
          if (!md) return;
          if (!(id in seen)) {
            seen[id] = md;
            orderedIds.push(id);
          } else if (md.length > seen[id].length) {
            seen[id] = md;
          }
        },
      );
    };

    // 找文档滚动容器
    const cands: Element[] = [];
    const direct = document.querySelector('.bear-web-x-container');
    if (direct) cands.push(direct);
    let cur = wrapper.parentElement;
    while (cur && cur !== document.documentElement) {
      cands.push(cur);
      cur = cur.parentElement;
    }
    let scroller: HTMLElement | null = null;
    for (const el of cands) {
      const cs = window.getComputedStyle(el as HTMLElement);
      if (
        /(auto|scroll)/.test(cs.overflowY) &&
        el.scrollHeight > el.clientHeight + 50
      ) {
        scroller = el as HTMLElement;
        break;
      }
    }
    if (!scroller) {
      scroller = document.scrollingElement as HTMLElement | null;
    }
    if (!scroller) return null;

    const savedTop = scroller.scrollTop;
    const step = Math.max(300, Math.floor(scroller.clientHeight * 0.7));
    const deadline = Date.now() + 45000;

    // 从头到尾扫一遍;虚拟滚动挂载有延迟,必要时第二遍补齐
    const onePass = async (): Promise<void> => {
      scroller.scrollTop = 0;
      await sleep(320);
      collect();
      let lastTop = -1;
      let stableCount = 0;
      for (let i = 0; i < 240; i++) {
        scroller.scrollTop += step;
        await sleep(300);
        collect();
        if (scroller.scrollTop === lastTop) {
          stableCount += 1;
          if (stableCount >= 4) break;
        } else {
          stableCount = 0;
          lastTop = scroller.scrollTop;
        }
        if (Date.now() > deadline) break;
      }
    };
    await onePass();
    if (Date.now() < deadline) {
      await onePass();
    }

    // 回到原位再补一次,防止顶部块未被渲染
    scroller.scrollTop = savedTop;
    await sleep(300);
    collect();

    // data-block-id 为文档顺序的连续数字;全部为数字时按其排序纠正跨遍乱序
    const allNumeric =
      orderedIds.length > 0 &&
      orderedIds.every((id) => /^\d+$/.test(id));
    const ids = allNumeric
      ? orderedIds.slice().sort((a, b) => Number(a) - Number(b))
      : orderedIds;
    const body = ids
      .map((id) => seen[id])
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!body || body.length < 20) return null;
    return title ? '# ' + title + '\n\n' + body : body;
  } catch {
    return null;
  }
};

// 在渲染后的 DOM 中提取 Markdown。供复制和知识库笔记共用。
export const getPageMarkdown = async (
  webContents: Electron.WebContents,
  includeSelection = true,
): Promise<string> => {
  if (!webContents || webContents.isDestroyed()) return '';
  // 飞书 docx/wiki 等虚拟滚动页面:先注入滚动收集器,无结果时回退通用转换。
  try {
    const feishuMd: unknown = await webContents.executeJavaScript(
      `(${feishuDocCollector.toString()})(${JSON.stringify(includeSelection)})`,
      true,
    );
    if (typeof feishuMd === 'string' && feishuMd.trim()) return feishuMd;
  } catch (e) {
    console.warn('[getPageMarkdown] feishu collector failed:', e);
  }
  // 该函数被序列化后注入页面执行,内部不能引用外部作用域变量。
  const converter = function (allowSelection: boolean) {
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

    const collapse = (text: string): string =>
      text
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
        .replace(/\s+/g, ' ');

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
        'catalogue',
        'catalog__',
        'outline',
        'toc-',
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
    const selection = allowSelection ? window.getSelection() : null;
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
      `(${converter.toString()})(${JSON.stringify(includeSelection)})`,
      true,
    );
    return typeof markdown === 'string' ? markdown : '';
  } catch (e) {
    console.error('[getPageMarkdown] failed:', e);
    return '';
  }
};

// 复制网页为 Markdown:优先复制选区,没有选区时复制整页正文。
export const copyPageAsMarkdown = async () => {
  const view = Application.instance.windows.current.viewManager.selected;
  if (!view) return;
  const { webContents } = view;
  const t = getMainTranslator(
    Application.instance.settings?.object?.language,
  );

  try {
    const markdown = await getPageMarkdown(webContents);
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
