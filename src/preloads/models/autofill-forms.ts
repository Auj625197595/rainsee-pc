// 网页内地址/银行卡自动填充(Chrome「地址及更多」「付款方式」)。
//
// 与密码引擎 auto-complete.ts 相互独立,只复用其 DOM 工具函数。流程:
//   1. 字段分类:autocomplete token > 关键词(name/id/placeholder/aria-label/label 文本)
//      > input.type 兜底;
//   2. 按表单分组,满足阈值(地址 ≥3 类字段;银行卡需含卡号)才视为可填表单;
//   3. 聚焦字段时向主进程要建议(只含展示文本),选中后主进程按需返回字段值,
//      整表填充(CVC 永不填);
//   4. 提交/点击提交按钮/离开页面时读取用户填写的值,交主进程判重后弹保存提示。
// 覆盖主帧与同源子帧(view-preload 不进子帧;跨源支付 iframe 不支持)。
import type {
  AutofillFieldType,
  AutofillKind,
  IAutofillSaveCandidate,
  IAutofillSuggestion,
} from '~/interfaces';
import { rendererCapabilities } from '../sandbox-bridge';
import { createLocaleTranslator } from '~/common/i18n';
import {
  collectDocs,
  isLikelySubmitControl,
  isVisible,
  setValue,
} from './auto-complete';

const windowId = rendererCapabilities.lifecycle.getWindowId();
const NativeWeakMap = WeakMap;
const NativeWeakSet = WeakSet;
const NativeMap = Map;
const tr = () => createLocaleTranslator(undefined);

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const CARD_TYPES: AutofillFieldType[] = [
  'cc-number',
  'cc-name',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
];
const isCardType = (type: AutofillFieldType) => CARD_TYPES.includes(type);

// ── 分类 ──

const AUTOCOMPLETE_MAP: Record<string, AutofillFieldType> = {
  name: 'name',
  'given-name': 'given-name',
  'family-name': 'family-name',
  organization: 'organization',
  'street-address': 'street',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-level1': 'state',
  'address-level2': 'city',
  'postal-code': 'postCode',
  country: 'country',
  'country-name': 'country',
  tel: 'phone',
  'tel-national': 'phone',
  email: 'email',
  'cc-number': 'cc-number',
  'cc-name': 'cc-name',
  'cc-given-name': 'cc-name',
  'cc-exp': 'cc-exp',
  'cc-exp-month': 'cc-exp-month',
  'cc-exp-year': 'cc-exp-year',
  'cc-csc': 'cc-csc',
};

// 关键词按优先级排列:先银行卡,再更具体的地址字段,最后泛化的「姓名」。
// latin 关键词与去分隔符后的属性值做包含匹配;short 列表要求整词命中,避免
// capacity→city、username→name 之类误判。
interface Rule {
  type: AutofillFieldType;
  latin?: string[];
  short?: string[];
  cjk?: string[];
}

// 卡号规则放在银行卡组最后:「银行卡持卡人」「信用卡有效期」应先命中更具体的规则。
const RULES: Rule[] = [
  {
    type: 'cc-csc',
    latin: ['cvv', 'cvc', 'csc', 'cvn', 'securitycode', 'cardverification'],
    cjk: ['安全码', '校验码'],
  },
  {
    type: 'cc-name',
    latin: ['cardholder', 'nameoncard', 'ccname', 'cardname', 'holdername'],
    cjk: ['持卡人'],
  },
  {
    type: 'cc-exp-month',
    latin: ['expmonth', 'expirymonth', 'expirationmonth', 'ccmonth', 'cardmonth'],
    cjk: ['有效期月', '到期月'],
  },
  {
    type: 'cc-exp-year',
    latin: ['expyear', 'expiryyear', 'expirationyear', 'ccyear', 'cardyear'],
    cjk: ['有效期年', '到期年'],
  },
  {
    type: 'cc-exp',
    latin: ['expiry', 'expiration', 'expdate', 'ccexp', 'validthru', 'mmyy'],
    cjk: ['有效期', '到期'],
  },
  {
    type: 'cc-number',
    latin: ['cardnumber', 'ccnumber', 'ccnum', 'cardno', 'creditcard', 'debitcard'],
    short: ['pan'],
    cjk: ['卡号', '银行卡', '信用卡'],
  },
  {
    type: 'given-name',
    latin: ['firstname', 'givenname', 'forename'],
    short: ['fname'],
    cjk: ['名字'],
  },
  {
    type: 'family-name',
    latin: ['lastname', 'familyname', 'surname'],
    short: ['lname'],
    cjk: ['姓氏'],
  },
  { type: 'email', latin: ['email'], short: ['mail'], cjk: ['邮箱', '电子邮件'] },
  {
    type: 'phone',
    latin: ['phone', 'mobile', 'telephone', 'cellphone'],
    short: ['tel', 'cell'],
    cjk: ['手机', '电话', '联系方式'],
  },
  {
    type: 'postCode',
    latin: ['postcode', 'postal', 'zipcode'],
    short: ['zip'],
    cjk: ['邮编', '邮政编码'],
  },
  { type: 'country', latin: ['country'], cjk: ['国家'] },
  {
    type: 'organization',
    latin: ['company', 'organization', 'organisation'],
    short: ['org'],
    cjk: ['公司', '单位'],
  },
  {
    type: 'address-line2',
    latin: ['addressline2', 'address2', 'addr2', 'apartment', 'suite'],
  },
  {
    type: 'state',
    latin: ['province', 'county'],
    short: ['state'],
    cjk: ['省份', '省'],
  },
  { type: 'city', short: ['city', 'town'], cjk: ['城市', '市'] },
  {
    type: 'street',
    latin: ['street', 'address', 'addressline1', 'address1'],
    short: ['addr'],
    cjk: ['详细地址', '街道', '地址'],
  },
  {
    type: 'name',
    latin: ['fullname', 'realname', 'consignee', 'receiver', 'recipient', 'contactname'],
    short: ['name'],
    cjk: ['姓名', '收货人', '收件人', '联系人'],
  },
];

const EXCLUDED = [
  'search',
  'captcha',
  'coupon',
  'promo',
  'voucher',
  'password',
  'username',
  'login',
  'quantity',
  'qty',
  'otp',
  '搜索',
  '验证码',
  '优惠',
  '密码',
  '账号',
  '帐号',
];

const NON_TEXT_INPUT = new Set([
  'hidden',
  'submit',
  'button',
  'checkbox',
  'radio',
  'file',
  'password',
  'image',
  'reset',
  'range',
  'color',
  'date',
  'datetime-local',
  'time',
  'week',
]);

const labelTextOf = (el: FieldEl): string => {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  try {
    if (el.id) {
      const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.textContent || '');
    }
    const wrapping = el.closest('label');
    if (wrapping) parts.push(wrapping.textContent || '');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const node = doc.getElementById(id);
        if (node) parts.push(node.textContent || '');
      });
    }
    // 国内表单常见「<span>收货人</span><input>」:取紧邻前一个兄弟的短文本
    if (!parts.length) {
      let prev = el.previousElementSibling;
      if (!prev && el.parentElement) prev = el.parentElement.previousElementSibling;
      const text = (prev?.textContent || '').trim();
      if (text && text.length <= 16) parts.push(text);
    }
  } catch {
    // 选择器异常忽略
  }
  return parts.join(' ').slice(0, 80);
};

const tokensOf = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const classifyCache = new NativeWeakMap<FieldEl, { sig: string; type: AutofillFieldType | null; explicit: boolean }>();

interface Classified {
  type: AutofillFieldType;
  // 来自 autocomplete 属性的显式声明
  explicit: boolean;
}

const classifyField = (el: FieldEl): Classified | null => {
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (NON_TEXT_INPUT.has(type)) return null;
  } else if (tag !== 'SELECT' && tag !== 'TEXTAREA') {
    return null;
  }
  if ((el as HTMLInputElement).readOnly || el.disabled) return null;

  const attrs = [
    el.getAttribute('name') || '',
    el.getAttribute('id') || '',
    el.getAttribute('placeholder') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('data-name') || '',
  ];
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const sig = `${autocomplete}|${attrs.join('|')}`;
  const cached = classifyCache.get(el);
  if (cached && cached.sig === sig) {
    return cached.type ? { type: cached.type, explicit: cached.explicit } : null;
  }

  const store = (type: AutofillFieldType | null, explicit = false) => {
    classifyCache.set(el, { sig, type, explicit });
    return type ? { type, explicit } : null;
  };

  const acTokens = autocomplete.split(/\s+/).filter(Boolean);
  if (acTokens.includes('one-time-code') || acTokens.includes('username')) {
    return store(null);
  }
  for (let i = acTokens.length - 1; i >= 0; i--) {
    const mapped = AUTOCOMPLETE_MAP[acTokens[i]];
    if (mapped) return store(mapped, true);
  }

  const label = labelTextOf(el);
  const raw = [...attrs, label].join(' ');
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[\s_\-.:[\]]/g, '');
  if (EXCLUDED.some((kw) => compact.indexOf(kw) >= 0)) return store(null);
  const tokens = new Set(attrs.flatMap(tokensOf).concat(tokensOf(label)));

  for (const rule of RULES) {
    if (rule.latin && rule.latin.some((kw) => compact.indexOf(kw) >= 0)) {
      return store(rule.type);
    }
    if (rule.short && rule.short.some((kw) => tokens.has(kw))) {
      return store(rule.type);
    }
    if (rule.cjk && rule.cjk.some((kw) => raw.indexOf(kw) >= 0)) {
      return store(rule.type);
    }
  }

  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || '').toLowerCase();
    if (type === 'email') return store('email');
    if (type === 'tel') return store('phone');
  }
  return store(null);
};

// ── 分组 ──

interface FieldEntry {
  el: FieldEl;
  type: AutofillFieldType;
  explicit: boolean;
}

interface FormGroup {
  root: Element;
  address: FieldEntry[];
  card: FieldEntry[];
}

const groupRootOf = (el: FieldEl): Element =>
  el.form ||
  el.closest('form, [role="form"], fieldset') ||
  el.ownerDocument.body ||
  el.ownerDocument.documentElement;

const collectGroup = (root: Element): FormGroup => {
  const group: FormGroup = { root, address: [], card: [] };
  const elements = Array.from(
    root.querySelectorAll('input, select, textarea'),
  ) as FieldEl[];
  if (root instanceof HTMLFormElement) {
    // form 属性关联到表单外的控件
    Array.from(root.elements).forEach((node) => {
      if (
        (node instanceof HTMLInputElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLTextAreaElement) &&
        elements.indexOf(node) < 0
      ) {
        elements.push(node);
      }
    });
  }
  for (const el of elements) {
    if (!isVisible(el as HTMLElement)) continue;
    const classified = classifyField(el);
    if (!classified) continue;
    const entry = { el, ...classified };
    if (isCardType(classified.type)) group.card.push(entry);
    else group.address.push(entry);
  }
  return group;
};

const distinctTypes = (entries: FieldEntry[]) =>
  new Set(entries.map((entry) => entry.type));

const qualifies = (group: FormGroup, kind: AutofillKind) => {
  if (kind === 'card') {
    const types = distinctTypes(group.card);
    if (!types.has('cc-number')) return false;
    return types.size >= 2 || group.card.some((e) => e.explicit && e.type === 'cc-number');
  }
  const types = distinctTypes(group.address);
  const explicit = group.address.filter((e) => e.explicit).length;
  return types.size >= 3 || (explicit >= 2 && types.size >= 2);
};

// ── 写值 ──

const COUNTRY_ALIASES: string[][] = [
  ['中国', 'cn', 'chn', 'china', '中华人民共和国', '中国大陆'],
  ['美国', 'us', 'usa', 'united states', 'united states of america'],
  ['香港', 'hk', 'hong kong', '中国香港'],
  ['台湾', 'tw', 'taiwan', '中国台湾'],
  ['澳门', 'mo', 'macao', 'macau', '中国澳门'],
  ['日本', 'jp', 'japan'],
  ['英国', 'gb', 'uk', 'united kingdom'],
  ['新加坡', 'sg', 'singapore'],
  ['加拿大', 'ca', 'canada'],
  ['澳大利亚', 'au', 'australia'],
  ['韩国', 'kr', 'korea', 'south korea'],
  ['德国', 'de', 'germany'],
  ['法国', 'fr', 'france'],
];

const norm = (value: string) =>
  value.toLowerCase().replace(/[\s.]/g, '').replace(/(省|市|自治区|特别行政区)$/, '');

const selectOption = (
  select: HTMLSelectElement,
  type: AutofillFieldType,
  value: string,
): boolean => {
  const options = Array.from(select.options);
  let match: HTMLOptionElement | undefined;
  if (type === 'cc-exp-month') {
    const month = Number(value);
    match = options.find(
      (o) => Number(o.value) === month || Number((o.text || '').replace(/\D/g, '')) === month,
    );
  } else if (type === 'cc-exp-year') {
    const yy = value.slice(-2);
    match = options.find((o) => {
      const v = (o.value || '').trim();
      const text = (o.text || '').trim();
      return v === value || text === value || v === yy || text === yy;
    });
  } else {
    let candidates = [value];
    if (type === 'country') {
      const lower = value.toLowerCase();
      const alias = COUNTRY_ALIASES.find((list) => list.includes(lower));
      if (alias) candidates = alias;
    }
    const wanted = candidates.map(norm);
    match =
      options.find((o) => wanted.includes(norm(o.value)) || wanted.includes(norm(o.text))) ||
      options.find((o) => {
        const text = norm(o.text);
        return !!text && wanted.some((w) => w.length >= 2 && (text.includes(w) || w.includes(text)));
      });
  }
  if (!match || match.disabled) return false;
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc?.set) desc.set.call(select, match.value);
    else select.value = match.value;
  } catch {
    select.value = match.value;
  }
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    select.style.backgroundColor = '#E2ECFE';
  } catch {}
  return true;
};

const formatExpiry = (el: FieldEl, month: string, year: string) => {
  const hint = `${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
  const maxLength = (el as HTMLInputElement).maxLength;
  if (/yyyy|年年年年/.test(hint) || maxLength === 7) return `${month}/${year}`;
  if (maxLength === 4) return `${month}${year.slice(-2)}`;
  if (/mm\s*-\s*yy/.test(hint)) return `${month}-${year.slice(-2)}`;
  return `${month}/${year.slice(-2)}`;
};

const writeValue = (entry: FieldEntry, value: string) => {
  if (!value) return false;
  const { el, type } = entry;
  if (el instanceof HTMLSelectElement) return selectOption(el, type, value);
  if (type === 'cc-number' && (el as HTMLInputElement).maxLength > 0) {
    const max = (el as HTMLInputElement).maxLength;
    // 部分站点卡号框带空格分组(maxlength 19/23)
    if (max < value.length) return false;
  }
  setValue(el as HTMLInputElement, value);
  return true;
};

// ── 下拉 ──

const ICON_PIN =
  '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M128 16a88.1 88.1 0 0 0-88 88c0 75.3 80 132.17 83.41 134.55a8 8 0 0 0 9.18 0C136 236.17 216 179.3 216 104a88.1 88.1 0 0 0-88-88Zm0 56a32 32 0 1 1-32 32 32 32 0 0 1 32-32Z"/></svg>';
const ICON_CARD =
  '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M224 48H32a16 16 0 0 0-16 16v128a16 16 0 0 0 16 16h192a16 16 0 0 0 16-16V64a16 16 0 0 0-16-16Zm0 40H32V64h192ZM136 176h-24a8 8 0 0 1 0-16h24a8 8 0 0 1 0 16Zm64 0h-32a8 8 0 0 1 0-16h32a8 8 0 0 1 0 16Z"/></svg>';

const DROPDOWN_ID = '__rainsee_af_suggest';

class SuggestDropdown {
  private ul: HTMLUListElement | null = null;
  private items: { li: HTMLLIElement; suggestion: IAutofillSuggestion }[] = [];
  private active = -1;
  public anchor: FieldEl | null = null;
  private onPick: ((s: IAutofillSuggestion) => void) | null = null;

  public get visible() {
    return !!this.ul;
  }

  public contains(node: Node | null) {
    return !!node && !!this.ul && this.ul.contains(node);
  }

  public hide = () => {
    if (this.ul?.parentNode) this.ul.parentNode.removeChild(this.ul);
    this.ul = null;
    this.items = [];
    this.active = -1;
    this.anchor = null;
    this.onPick = null;
  };

  public show(
    anchor: FieldEl,
    kind: AutofillKind,
    suggestions: IAutofillSuggestion[],
    onPick: (s: IAutofillSuggestion) => void,
    onManage: () => void,
  ) {
    this.hide();
    if (!suggestions.length) return;
    this.anchor = anchor;
    this.onPick = onPick;
    const doc = anchor.ownerDocument || document;
    const win = doc.defaultView || window;
    const rect = anchor.getBoundingClientRect();
    const ul = doc.createElement('ul');
    ul.id = DROPDOWN_ID;
    ul.setAttribute('role', 'listbox');
    Object.assign(ul.style, {
      position: 'absolute',
      left: `${win.scrollX + rect.left}px`,
      top: `${win.scrollY + rect.bottom + 6}px`,
      minWidth: `${Math.max(rect.width, 260)}px`,
      maxWidth: '380px',
      maxHeight: '320px',
      overflowY: 'auto',
      boxSizing: 'border-box',
      margin: '0',
      padding: '6px',
      listStyle: 'none',
      background: 'rgba(255, 255, 255, 0.92)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(0, 0, 0, 0.08)',
      borderRadius: '14px',
      boxShadow: '0 8px 32px rgba(31, 38, 135, 0.18)',
      zIndex: '2147483647',
      fontSize: '13px',
      color: '#222',
      textAlign: 'left',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
    } as any);

    suggestions.forEach((suggestion, index) => {
      const li = doc.createElement('li');
      li.setAttribute('role', 'option');
      Object.assign(li.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 10px',
        margin: '2px 0',
        borderRadius: '9px',
        cursor: 'pointer',
        listStyle: 'none',
      } as any);
      const icon = doc.createElement('span');
      icon.innerHTML = kind === 'card' ? ICON_CARD : ICON_PIN;
      Object.assign(icon.style, {
        display: 'flex',
        color: kind === 'card' ? '#16a34a' : '#3b82f6',
        flexShrink: '0',
      } as any);
      const info = doc.createElement('div');
      Object.assign(info.style, {
        display: 'flex',
        flexDirection: 'column',
        minWidth: '0',
        overflow: 'hidden',
      } as any);
      const label = doc.createElement('span');
      label.textContent = suggestion.label;
      Object.assign(label.style, {
        fontWeight: '500',
        color: '#222',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      } as any);
      info.appendChild(label);
      if (suggestion.sublabel) {
        const sub = doc.createElement('span');
        sub.textContent = suggestion.sublabel;
        Object.assign(sub.style, {
          color: '#888',
          fontSize: '12px',
          marginTop: '2px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        } as any);
        info.appendChild(sub);
      }
      li.appendChild(icon);
      li.appendChild(info);
      li.addEventListener('mouseenter', () => this.setActive(index));
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.pick(index);
      });
      ul.appendChild(li);
      this.items.push({ li, suggestion });
    });

    const footer = doc.createElement('li');
    footer.textContent =
      kind === 'card' ? tr()('autofillManagePayments') : tr()('autofillManageAddresses');
    Object.assign(footer.style, {
      padding: '9px 10px',
      marginTop: '4px',
      fontSize: '12px',
      fontWeight: '500',
      color: '#3b82f6',
      cursor: 'pointer',
      borderTop: '1px solid rgba(0,0,0,0.06)',
      listStyle: 'none',
    } as any);
    footer.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onManage();
      this.hide();
    });
    ul.appendChild(footer);

    (doc.body || doc.documentElement).appendChild(ul);
    this.ul = ul;
  }

  private setActive(index: number) {
    this.items.forEach((item, i) => {
      item.li.style.background = i === index ? 'rgba(59, 130, 246, 0.12)' : 'transparent';
    });
    this.active = index;
  }

  private pick(index: number) {
    const item = this.items[index];
    const onPick = this.onPick;
    this.hide();
    if (item && onPick) onPick(item.suggestion);
  }

  // 返回 true 表示按键已被下拉消费
  public handleKey(event: KeyboardEvent): boolean {
    if (!this.ul) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = this.items.length;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.setActive((this.active + delta + count) % count);
      return true;
    }
    if (event.key === 'Enter' && this.active >= 0) {
      this.pick(this.active);
      return true;
    }
    if (event.key === 'Escape') {
      this.hide();
      return true;
    }
    return false;
  }
}

// ── 引擎 ──

const readValue = (entry: FieldEntry): string => {
  const { el, type } = entry;
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (!option || !option.value) return '';
    if (type === 'cc-exp-month' || type === 'cc-exp-year') return option.value.trim();
    return (option.text || option.value).trim();
  }
  return (el.value || '').trim();
};

const parseExpiry = (value: string) => {
  const match = value.replace(/\s/g, '').match(/^(\d{1,2})[/\-.]?(\d{2}|\d{4})$/);
  if (!match) return { month: '', year: '' };
  return { month: match[1], year: match[2] };
};

const isCjk = (value: string) => /[一-龥]/.test(value);

class AutofillFormsEngine {
  private dropdown = new SuggestDropdown();
  private boundDocs = new NativeWeakSet<Document>();
  private dirtyRoots = new NativeWeakSet<Element>();
  private filledSnapshots = new NativeWeakMap<Element, string>();
  private lastRoot: Element | null = null;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestSeq = 0;
  private lastSent = new NativeMap<string, number>();
  private observer: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  public start = () => {
    this.bindAllDocs();
    if (!this.observer) {
      // 同源 iframe 可能稍后插入,DOM 变化时补绑
      this.observer = new MutationObserver(() => {
        if (this.scanTimer) return;
        this.scanTimer = setTimeout(() => {
          this.scanTimer = null;
          this.bindAllDocs();
        }, 800);
      });
      try {
        this.observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch {}
    }
    window.addEventListener('pagehide', () => this.captureDirty(), true);
  };

  private bindAllDocs() {
    for (const doc of collectDocs(window, [])) this.bindDoc(doc);
  }

  private bindDoc(doc: Document) {
    if (!doc || this.boundDocs.has(doc)) return;
    this.boundDocs.add(doc);
    doc.addEventListener('focusin', this.onFocus, true);
    doc.addEventListener('click', this.onClick, true);
    doc.addEventListener('input', this.onInput, true);
    doc.addEventListener('change', this.onInput, true);
    doc.addEventListener('keydown', this.onKeyDown, true);
    doc.addEventListener('submit', this.onSubmit, true);
    doc.addEventListener(
      'mousedown',
      (event) => {
        if (!this.dropdown.contains(event.target as Node)) {
          const target = event.target as Element | null;
          if (target !== this.dropdown.anchor) this.dropdown.hide();
        }
      },
      true,
    );
    doc.addEventListener(
      'scroll',
      () => {
        if (this.dropdown.visible) this.dropdown.hide();
      },
      { capture: true, passive: true },
    );
  }

  private fieldOf(target: EventTarget | null): FieldEl | null {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return target;
    }
    // 同源 iframe 内元素的构造器来自子窗口,instanceof 失败,按 tagName 判定
    const el = target as Element | null;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || '')) return el as FieldEl;
    return null;
  }

  private onFocus = (event: Event) => {
    const el = this.fieldOf(event.target);
    if (!el) return;
    this.maybeSuggest(el, false);
  };

  private onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const el = this.fieldOf(target);
    if (el) {
      if (!this.dropdown.visible) this.maybeSuggest(el, false);
      return;
    }
    if (target && isLikelySubmitControl(target)) {
      const control = target.closest('button, input, [role="button"]') as HTMLElement | null;
      const form = (control as HTMLButtonElement | null)?.form || control?.closest('form');
      this.captureRoot(form || this.lastRoot);
    }
  };

  private onInput = (event: Event) => {
    const el = this.fieldOf(event.target);
    if (!el || !event.isTrusted) return;
    const classified = classifyField(el);
    if (!classified) return;
    const root = groupRootOf(el);
    this.dirtyRoots.add(root);
    this.lastRoot = root;
    if (event.type === 'input' && !(el instanceof HTMLSelectElement)) {
      this.maybeSuggest(el, true);
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.dropdown.visible && this.fieldOf(event.target) === this.dropdown.anchor) {
      if (this.dropdown.handleKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  private onSubmit = (event: Event) => {
    this.captureRoot(event.target as Element);
  };

  private maybeSuggest(el: FieldEl, typed: boolean) {
    if (el instanceof HTMLSelectElement) return;
    const classified = classifyField(el);
    if (!classified || classified.type === 'cc-csc') {
      if (this.dropdown.anchor === el) this.dropdown.hide();
      return;
    }
    const kind: AutofillKind = isCardType(classified.type) ? 'card' : 'address';
    const root = groupRootOf(el);
    const group = collectGroup(root);
    if (!qualifies(group, kind)) return;
    this.lastRoot = root;

    const prefix = typed ? (el.value || '') : '';
    // 卡号:已输入内容时不再提示(对齐 Chrome)
    if (kind === 'card' && prefix) {
      this.dropdown.hide();
      return;
    }
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    const seq = ++this.suggestSeq;
    this.suggestTimer = setTimeout(async () => {
      this.suggestTimer = null;
      try {
        const suggestions = await rendererCapabilities.autofillProfiles.suggest(
          kind,
          classified.type,
          prefix,
        );
        if (seq !== this.suggestSeq) return;
        const doc = el.ownerDocument;
        if (doc.activeElement !== el) return;
        if (!suggestions || !suggestions.length) {
          this.dropdown.hide();
          return;
        }
        this.dropdown.show(
          el,
          kind,
          suggestions,
          (picked) => void this.fill(root, kind, picked.id),
          () =>
            rendererCapabilities.autofillProfiles.openSettings(
              windowId,
              kind === 'card' ? 'payment-methods' : 'addresses',
            ),
        );
      } catch {
        // 主进程不可用时静默
      }
    }, typed ? 120 : 0);
  }

  private async fill(root: Element, kind: AutofillKind, id: string) {
    const group = collectGroup(root);
    const entries = kind === 'card' ? group.card : group.address;
    const types = Array.from(distinctTypes(entries)).filter((type) => type !== 'cc-csc');
    if (kind === 'card' && types.includes('cc-exp')) {
      types.push('cc-exp-month', 'cc-exp-year');
    }
    const values = await rendererCapabilities.autofillProfiles.fill(kind, id, types);
    if (!values) return;

    for (const entry of entries) {
      let value = '';
      switch (entry.type) {
        case 'cc-csc':
          continue;
        case 'cc-exp':
          if (values['cc-exp-month'] && values['cc-exp-year'] && !(entry.el instanceof HTMLSelectElement)) {
            value = formatExpiry(entry.el, values['cc-exp-month'], values['cc-exp-year']);
          } else {
            value = values['cc-exp'] || '';
          }
          break;
        case 'street':
        case 'address-line1':
          value = values[entry.type] || values.street || values['address-line1'] || '';
          break;
        default:
          value = values[entry.type] || '';
      }
      try {
        writeValue(entry, value);
      } catch {
        // 单个字段失败不影响其余
      }
    }
    // 记录填入后的快照,提交时与之相同则不弹保存
    this.filledSnapshots.set(root, JSON.stringify(this.readCandidate(root, kind)));
  }

  private readCandidate(root: Element, kind: AutofillKind): IAutofillSaveCandidate | null {
    const group = collectGroup(root);
    const get = (entries: FieldEntry[], type: AutofillFieldType) => {
      for (const entry of entries) {
        if (entry.type === type) {
          const value = readValue(entry);
          if (value) return value;
        }
      }
      return '';
    };

    if (kind === 'card') {
      if (!qualifies(group, 'card')) return null;
      const number = get(group.card, 'cc-number').replace(/[\s-]/g, '');
      if (!/^\d{12,19}$/.test(number)) return null;
      let expMonth = get(group.card, 'cc-exp-month');
      let expYear = get(group.card, 'cc-exp-year');
      const exp = get(group.card, 'cc-exp');
      if ((!expMonth || !expYear) && exp) {
        const parsed = parseExpiry(exp);
        expMonth = expMonth || parsed.month;
        expYear = expYear || parsed.year;
      }
      return {
        kind,
        card: { number, expMonth, expYear, holderName: get(group.card, 'cc-name') },
      };
    }

    if (!qualifies(group, 'address')) return null;
    const a = group.address;
    let name = get(a, 'name');
    if (!name) {
      const given = get(a, 'given-name');
      const family = get(a, 'family-name');
      name = isCjk(given + family) ? `${family}${given}` : [given, family].filter(Boolean).join(' ');
    }
    const street = [get(a, 'street') || get(a, 'address-line1'), get(a, 'address-line2')]
      .filter(Boolean)
      .join(' ');
    return {
      kind,
      address: {
        name,
        organization: get(a, 'organization'),
        street,
        city: get(a, 'city'),
        state: get(a, 'state'),
        postCode: get(a, 'postCode'),
        country: get(a, 'country'),
        phone: get(a, 'phone'),
        email: get(a, 'email'),
      },
    };
  }

  private captureRoot(root: Element | null) {
    if (!root) return;
    const resolved =
      root instanceof HTMLFormElement || root.tagName === 'FORM'
        ? root
        : root.closest?.('form, [role="form"], fieldset') || root;
    // 提交按钮可能在分组根之外,回退到最近交互的分组
    const target = this.dirtyRoots.has(resolved) ? resolved : this.lastRoot;
    if (!target || !this.dirtyRoots.has(target)) return;
    this.sendCandidates(target);
  }

  private captureDirty() {
    if (this.lastRoot && this.dirtyRoots.has(this.lastRoot)) {
      this.sendCandidates(this.lastRoot);
    }
  }

  private sendCandidates(root: Element) {
    const snapshot = this.filledSnapshots.get(root);
    for (const kind of ['card', 'address'] as AutofillKind[]) {
      let candidate: IAutofillSaveCandidate | null = null;
      try {
        candidate = this.readCandidate(root, kind);
      } catch {
        candidate = null;
      }
      if (!candidate) continue;
      const serialized = JSON.stringify(candidate);
      if (snapshot && snapshot === serialized) continue;
      const now = Date.now();
      if (now - (this.lastSent.get(serialized) || 0) < 5000) continue;
      this.lastSent.set(serialized, now);
      rendererCapabilities.autofillProfiles.showSavePrompt(windowId, candidate);
    }
  }
}

export default new AutofillFormsEngine();
