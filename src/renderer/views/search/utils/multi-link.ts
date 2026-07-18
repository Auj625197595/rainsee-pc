// 多链接助手:从一段文本里提取所有 http/https/ftp URL,并把文本切成
// 「普通段 / 链接段」序列,供渲染层高亮 + 点击跳转。
// 参考 Android MutiLinkTextView.setTextWithLinks。

export interface LinkSegment {
  value: string;
  isLink: boolean;
  url?: string;
}

export interface MultiLinkResult {
  segments: LinkSegment[];
  count: number;
  // 内容预估高度(px),供窗口高度计算在「实际测量值到达前」作首帧 fallback。
  estimatedHeight: number;
}

// 匹配 http/https/ftp URL。比 Android 原正则更宽容,
// 能吃下中文文本里带 query/fragment/中文 path 的 URL。
const URL_RE = /(?:ht|f)tps?:\/\/[^\s<>"']+/gi;

// 收尾标点(中英文):人类书写时常附在 URL 后,但不属于 URL 本身。
const TRAILING_PUNCT_RE = /[.,;:!?,。，；！？、…]+$/;

// 括号配对表:用于按「右比左多」配平剥离尾括号。
const BRACKET_PAIRS: Array<{ close: string; closeRe: RegExp; openRe: RegExp }> = [
  { close: ')', closeRe: /\)/g, openRe: /\(/g },
  { close: ']', closeRe: /\]/g, openRe: /\[/g },
  { close: '}', closeRe: /\}/g, openRe: /\{/g },
];

// 剥离 URL 末尾不属于它的标点;括号 ) ] } 按「右>左」配平剥多余项。
function trimTrailingPunct(raw: string): string {
  let s = raw;
  for (;;) {
    const tail = s.match(TRAILING_PUNCT_RE);
    if (tail) {
      s = s.slice(0, s.length - tail[0].length);
      continue;
    }
    const last = s.charAt(s.length - 1);
    const pair = BRACKET_PAIRS.find((p) => p.close === last);
    if (pair) {
      const close = (s.match(pair.closeRe) || []).length;
      const open = (s.match(pair.openRe) || []).length;
      if (close > open) {
        s = s.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return s;
}

// 首尾包裹标点(用于纯单链接判定):常用于「包围」URL 的成对/单个标点(中英文)。
const WRAP_RE = /^[.,;:!?,。，；！？、…()（）\[\]【】{}「『」』]+|[.,;:!?,。，；！？、…()（）\[\]【】{}「『」』]+$/g;

// ---- 高度预估(与 MultiLink/style.ts 的几何对齐) ----
// 文本区 line-height 20px、上下 padding 各 8px、最多展示 4 行(超出滚动)。
export const MULTI_LINK_LINE_HEIGHT = 20;
export const MULTI_LINK_PADDING_Y = 16;
export const MULTI_LINK_MAX_LINES = 4;

export function multiLinkHeightForLines(lines: number): number {
  return (
    MULTI_LINK_PADDING_Y +
    Math.min(Math.max(lines, 1), MULTI_LINK_MAX_LINES) * MULTI_LINK_LINE_HEIGHT
  );
}

// 估算文本在文本区里占的行数。CJK/全角按 14px、其余按 7px,
// 按可用宽度折行并计入显式换行;URL 因 word-break:break-all 同样按宽度折。
function estimateLines(text: string): number {
  const lineWidth = 640; // MultiLinkText 大致可用宽度(px)
  const widthOf = (ch: string) =>
    /[　-鿿＀-￯]/.test(ch) ? 14 : 7;
  let lines = 0;
  for (const seg of text.split('\n')) {
    if (seg.length === 0) {
      lines++;
      continue;
    }
    let w = 0;
    for (const ch of seg) w += widthOf(ch);
    lines += Math.max(1, Math.ceil(w / lineWidth));
  }
  return Math.max(1, lines);
}

// 解析文本中的链接并切片。无链接 / 整段就是单个 URL 时返回 null
// (后者保留给原「前往」直达,避免劫持所有剪贴板直达场景)。
export function extractLinks(text: string): MultiLinkResult | null {
  if (!text) return null;

  // 收集所有 URL 匹配。保留 raw 以便切片时把被剥的尾标点留在普通段。
  URL_RE.lastIndex = 0;
  const matches: Array<{ index: number; raw: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0];
    const url = trimTrailingPunct(raw);
    if (url) matches.push({ index: m.index, raw, url });
  }
  if (matches.length === 0) return null;

  // 纯单链接豁免:整段去掉唯一 URL 后,若剩余仅空白/包裹标点 → 走原直达。
  if (matches.length === 1) {
    const remain = text.trim().replace(matches[0].url, '').trim();
    const core = remain.replace(WRAP_RE, '').trim();
    if (core === '') return null;
  }

  // 切片:按每个匹配的 index 切「普通段 + 链接段」。
  const segments: LinkSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ value: text.slice(cursor, match.index), isLink: false });
    }
    segments.push({ value: match.url, isLink: true, url: match.url });
    // raw 可能比 url 长(尾标点被剥),被剥部分留在后续普通段。
    cursor = match.index + match.raw.length;
  }
  if (cursor < text.length) {
    segments.push({ value: text.slice(cursor), isLink: false });
  }

  return {
    segments,
    count: matches.length,
    estimatedHeight: multiLinkHeightForLines(estimateLines(text)),
  };
}
