import { ISearchEngine } from '~/interfaces';

// 搜索引擎「快捷字词」:地址栏输入「字词 + 空格」临时切换到该引擎搜索。
// 未自定义时默认取引擎名称首字母:汉字取拼音首字母(百度→bd),
// 英文单词取首字母 + 词内大写字母(GitHub→gh、Google→g),数字原样保留(360搜索→360ss)。

// 各拼音首字母区间的起始汉字(zh-CN 排序规则下)。i/u/v 不作声母,无对应区间。
const PINYIN_BOUNDARIES = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥扨它穵夕丫帀';
const PINYIN_LETTERS = 'abcdefghjklmnopqrstwxyz';

let collator: Intl.Collator | null | undefined;
const getCollator = () => {
  if (collator !== undefined) return collator;
  try {
    const c = new Intl.Collator('zh-CN');
    // 运行时缺少中文排序数据时无法按拼音比较,放弃汉字首字母。
    collator = c.resolvedOptions().locale.startsWith('zh') ? c : null;
  } catch {
    collator = null;
  }
  return collator;
};

const pinyinInitial = (char: string) => {
  const c = getCollator();
  if (!c) return '';
  let letter = '';
  for (let i = 0; i < PINYIN_BOUNDARIES.length; i++) {
    if (c.compare(PINYIN_BOUNDARIES[i], char) <= 0) letter = PINYIN_LETTERS[i];
    else break;
  }
  return letter;
};

const defaultCache = new Map<string, string>();

export const getDefaultShortcut = (name: string | undefined): string => {
  const source = (name || '').trim();
  if (!source) return '';
  const cached = defaultCache.get(source);
  if (cached !== undefined) return cached;

  // 去掉括号补充说明:「必应(国内)」→「必应」
  const base = source.replace(/[（(][^）)]*[）)]/g, '').trim() || source;
  let result = '';
  const tokens = base.match(/[一-鿿]|[A-Za-z]+|\d+/g) || [];
  for (const token of tokens) {
    if (/^[一-鿿]$/.test(token)) {
      result += pinyinInitial(token);
    } else if (/^\d+$/.test(token)) {
      result += token;
    } else {
      result += token[0] + token.slice(1).replace(/[^A-Z]/g, '');
    }
  }
  result = result.toLowerCase();
  defaultCache.set(source, result);
  return result;
};

export const normalizeShortcut = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '') : '';

// 解析整个列表的生效快捷字词(与 engines 下标一一对应)。
// 用户自定义的字词优先占位;默认字词撞名时追加数字后缀(g、g2…),保证唯一。
export const resolveEngineShortcuts = (
  engines: ISearchEngine[] | undefined,
): string[] => {
  const list = engines || [];
  const used = new Set<string>();
  const result: string[] = new Array(list.length).fill('');

  list.forEach((engine, i) => {
    const custom = normalizeShortcut(engine?.shortcut);
    if (custom && !used.has(custom)) {
      used.add(custom);
      result[i] = custom;
    }
  });

  list.forEach((engine, i) => {
    if (result[i]) return;
    const base = getDefaultShortcut(engine?.name);
    if (!base) return;
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}${n}`;
    used.add(candidate);
    result[i] = candidate;
  });

  return result;
};

export const findEngineByShortcut = (
  engines: ISearchEngine[] | undefined,
  token: string,
): ISearchEngine | null => {
  const key = normalizeShortcut(token);
  if (!key) return null;
  const index = resolveEngineShortcuts(engines).indexOf(key);
  return index >= 0 ? engines[index] : null;
};

export const getEngineShortcut = (
  engines: ISearchEngine[] | undefined,
  engine: ISearchEngine,
): string => {
  const index = (engines || []).indexOf(engine);
  return index >= 0 ? resolveEngineShortcuts(engines)[index] : '';
};

// 「字词 + 空格 + 搜索词」整句解析(粘贴后回车等未进入快捷模式的路径兜底)。
export const parseShortcutSearch = (
  text: string,
  engines: ISearchEngine[] | undefined,
): { engine: ISearchEngine; query: string } | null => {
  const match = /^(\S+)\s+([\s\S]*\S)\s*$/.exec(text || '');
  if (!match) return null;
  const engine = findEngineByShortcut(engines, match[1]);
  if (!engine || !engine.url) return null;
  return { engine, query: match[2].trim() };
};

export const buildEngineSearchUrl = (engine: ISearchEngine, query: string) => {
  const template = engine.url || '';
  const q = encodeURIComponent(query);
  return template.includes('%s') ? template.replace('%s', q) : template + q;
};
