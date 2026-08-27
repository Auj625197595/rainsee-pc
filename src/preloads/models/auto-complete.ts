import { ipcRenderer } from 'electron';

import { IFormFillData } from '~/interfaces';
import { windowId } from '../view-preload';

// 字段分类关键词表(中英文),对齐鸿蒙 AutoFillUtil.inject 注入脚本的 m 表。
// 命中任意一个属性值即归类。顺序:password 最强,其次 login_name。
const KW_PASSWORD = ['passwd', 'password', '密码', 'pwd'];
const KW_LOGIN = [
  'username',
  'user',
  'account',
  'login',
  'usr',
  'nick',
  'email',
  'phone',
  'mobile',
  'tel',
  'name',
  'sign',
  '用户名',
  '账号',
  '帐号',
  '邮箱',
  '手机',
];

type FieldKind = 'password' | 'login' | 'none';

// 验证码字段排除关键词(对齐 huliantest content.js),避免把验证码框当账号框
const KW_CAPTCHA = ['captcha', 'verifycode', 'checkcode', 'vcode', '验证码'];
const KW_EXCLUDED_LOGIN = ['otp', 'one-time', 'search', 'query', '搜索'];
const KW_UNRELATED_LOGIN = [
  'newsletter',
  'subscribe',
  'subscription',
  'invite',
  'contact',
];

// 单条候选账号(主进程按域名匹配下发)
interface Credential {
  id: string;
  username: string;
  password: string;
  host: string;
}

// 元素是否可见(对齐鸿蒙跳过 hidden / 不可见)
const isVisible = (el: HTMLElement): boolean => {
  if (!el) return false;
  const input = el as HTMLInputElement;
  if (input.type === 'hidden') return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  // 用元素所属窗口的 getComputedStyle,兼容跨 frame 元素(iframe 内 input)
  const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const style = view.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
};

// 分类器:type=password 是最强信号;非 password 类型只检查标准表单语义属性。
// 不能遍历所有属性:例如华为账号框的埋点属性 ht="input_pwdlogin_account"
// 同时含 pwd 和 account,若先命中 pwd 就会把密码写进账号框。
const classify = (el: HTMLInputElement): FieldKind => {
  const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (autocomplete.includes('one-time-code')) return 'none';
  if (type === 'password') return 'password';
  if (
    type === 'hidden' ||
    type === 'submit' ||
    type === 'button' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'file'
  ) {
    return 'none';
  }

  // 排除验证码框(placeholder/name 命中验证码关键词),否则会误填账号
  const ph = (el.getAttribute('placeholder') || '').toLowerCase();
  const nm = (el.getAttribute('name') || '').toLowerCase();
  for (const kw of KW_CAPTCHA) {
    if (ph.indexOf(kw) >= 0 || nm.indexOf(kw) >= 0) return 'none';
  }
  if (
    nm === 'code' ||
    KW_EXCLUDED_LOGIN.some((kw) => ph.indexOf(kw) >= 0 || nm.indexOf(kw) >= 0)
  )
    return 'none';

  const semanticValues = [
    el.getAttribute('name') || '',
    el.getAttribute('id') || '',
    el.getAttribute('placeholder') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('autocomplete') || '',
    el.getAttribute('class') || '',
  ].map((value) => value.toLowerCase());
  const hit = (kws: string[], values = semanticValues): boolean => {
    for (const value of values) {
      if (!value) continue;
      for (const kw of kws) {
        if (value.indexOf(kw) >= 0) return true;
      }
    }
    return false;
  };
  // class 常含埋点组合词(如 input_pwdlogin_account)，不能据此把账号框判成密码框。
  if (hit(KW_PASSWORD, semanticValues.slice(0, 5))) return 'password';
  if (hit(KW_LOGIN)) return 'login';

  // type 兜底:email/tel 视为账号
  if (type === 'email' || type === 'tel') return 'login';
  return 'none';
};

// 原生赋值 + 派发事件:React/Vue 受控组件必须走原生 setter 再 dispatch input,
// 否则框架内部 state 不更新,提交时拿到的还是空(对齐鸿蒙 d(el,val) 的 dispatchEvent)。
const setValue = (el: HTMLInputElement, value: string) => {
  try {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  } catch (e) {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // 轻微高亮,提示已自动填充
  try {
    el.style.backgroundColor = '#E2ECFE';
  } catch (e) {}
};

// 全文档扫描可见 input,返回登录相关字段(对齐鸿蒙 querySelectorAll("input"))
const scanInputs = (): HTMLInputElement[] => {
  const all = Array.from(
    document.querySelectorAll('input'),
  ) as HTMLInputElement[];
  return all.filter((el) => isVisible(el) && classify(el) !== 'none');
};

const isLikelySubmitControl = (target: HTMLElement | null) => {
  if (!target || typeof target.closest !== 'function') return false;
  const control = target.closest(
    'button, input[type="submit"], input[type="image"], [role="button"]',
  ) as HTMLElement | null;
  if (!control) return false;
  if (control instanceof HTMLInputElement) return true;
  if (control instanceof HTMLButtonElement) {
    const type = (control.getAttribute('type') || 'submit').toLowerCase();
    if (type === 'submit') return true;
  }
  const semantic = [
    control.textContent || '',
    control.getAttribute('aria-label') || '',
    control.getAttribute('name') || '',
    control.getAttribute('id') || '',
    control.getAttribute('class') || '',
  ]
    .join(' ')
    .toLowerCase();
  return [
    'login',
    'log in',
    'sign in',
    'register',
    'sign up',
    'signup',
    'create account',
    'submit',
    'continue',
    'next',
    '登录',
    '登入',
    '注册',
    '创建账号',
    '提交',
    '继续',
    '下一步',
    '确定',
  ].some((keyword) => semantic.indexOf(keyword) >= 0);
};

// 递归收集所有同源可访问的 document。登录表单常被放在 iframe 内(如友盟/阿里系
// passport 登录页),主文档查不到密码框;遍历各 frame 的 document 才能定位。
// 跨域 frame 访问 contentDocument 会抛 SecurityError,catch 跳过。
const collectDocs = (win: Window, acc: Document[]): Document[] => {
  try {
    acc.push(win.document);
    for (let i = 0; i < win.frames.length; i++) {
      collectDocs(win.frames[i], acc);
    }
  } catch (e) {}
  return acc;
};

interface LocatedFields {
  password: HTMLInputElement | null;
  username: HTMLInputElement | null;
  savePassword: HTMLInputElement | null;
  confirmationPassword: HTMLInputElement | null;
  isLoginForm: boolean;
}

const autocompleteOf = (el: HTMLInputElement) =>
  (el.getAttribute('autocomplete') || '').toLowerCase();

const autocompleteTokensOf = (el: HTMLInputElement) =>
  autocompleteOf(el).split(/\s+/).filter(Boolean);

const isUsernameFallbackCandidate = (el: HTMLInputElement) => {
  const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
  if (type !== 'text' && type !== 'email' && type !== 'tel') return false;
  if (autocompleteTokensOf(el).includes('one-time-code')) return false;
  const values = [
    el.getAttribute('name') || '',
    el.getAttribute('id') || '',
    el.getAttribute('placeholder') || '',
    el.getAttribute('aria-label') || '',
  ].map((value) => value.toLowerCase());
  return !values.some((value) =>
    [...KW_CAPTCHA, ...KW_EXCLUDED_LOGIN, ...KW_UNRELATED_LOGIN, 'code'].some(
      (keyword) => value === keyword || value.indexOf(keyword) >= 0,
    ),
  );
};

const isExplicitUsernameCandidate = (el: HTMLInputElement) => {
  if (!isUsernameFallbackCandidate(el)) return false;
  return classify(el) === 'login';
};

const isConfirmationPassword = (el: HTMLInputElement) => {
  const values = [
    el.getAttribute('name') || '',
    el.getAttribute('id') || '',
    el.getAttribute('placeholder') || '',
    el.getAttribute('aria-label') || '',
  ].map((value) => value.toLowerCase());
  return values.some((value) =>
    [
      'confirm',
      'confirmation',
      'repeat',
      'retype',
      '确认',
      '重复',
      '再次',
    ].some((keyword) => value.indexOf(keyword) >= 0),
  );
};

const hasSemanticKeyword = (values: string[], keywords: string[]) =>
  values.some((value) =>
    keywords.some((keyword) => value.indexOf(keyword) >= 0),
  );

// 一些登录组件会用 new-password 抑制浏览器原生候选。只在表单、提交控件、
// 字段或页面路径具有登录语义时接受，并显式排除注册、找回和改密表单。
const isMislabeledLoginPassword = (el: HTMLInputElement) => {
  const loginKeywords = [
    'login',
    'log-in',
    'log_in',
    'signin',
    'sign-in',
    'sign_in',
    'logon',
    'session',
    'current-password',
    'currentpassword',
    '登录',
    '登入',
  ];
  const nonLoginKeywords = [
    'register',
    'registration',
    'signup',
    'sign-up',
    'sign_up',
    'reset',
    'forgot',
    'recover',
    'change-password',
    'changepassword',
    '注册',
    '重置',
    '找回',
    '修改密码',
  ];
  const valuesOf = (element: Element) =>
    [
      element.getAttribute('id') || '',
      element.getAttribute('name') || '',
      element.getAttribute('class') || '',
      element.getAttribute('aria-label') || '',
    ].map((value) => value.toLowerCase());
  const form = el.form;
  const fieldValues = [
    ...valuesOf(el),
    el.getAttribute('placeholder') || '',
    el.getAttribute('autocomplete') || '',
    el.getAttribute('data-loginname') || '',
  ].map((value) => value.toLowerCase());
  const formValues = form
    ? [
        ...valuesOf(form),
        (form.getAttribute('action') || '').split(/[?#]/)[0].toLowerCase(),
      ]
    : [];
  const controlValues = form
    ? Array.from(
        form.querySelectorAll<HTMLElement>(
          'button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]',
        ),
      )
        .flatMap((control) => [
          control.textContent || '',
          control.getAttribute('value') || '',
          ...valuesOf(control),
        ])
        .map((value) => value.toLowerCase())
    : [];
  const formHasLogin = hasSemanticKeyword(formValues, loginKeywords);
  const formHasNonLogin = hasSemanticKeyword(formValues, nonLoginKeywords);
  const controlHasLogin = hasSemanticKeyword(controlValues, loginKeywords);
  const controlHasNonLogin = hasSemanticKeyword(
    controlValues,
    nonLoginKeywords,
  );
  if (
    (controlHasNonLogin && !controlHasLogin) ||
    (formHasNonLogin && !controlHasLogin)
  ) {
    return false;
  }
  const pathname = (
    el.ownerDocument.defaultView?.location.pathname || ''
  ).toLowerCase();
  const loginPath = /(^|[\/_.-])(login|signin|sign-in|logon)([\/_.-]|$)/.test(
    pathname,
  );
  return (
    hasSemanticKeyword(fieldValues, loginKeywords) ||
    formHasLogin ||
    controlHasLogin ||
    loginPath
  );
};

// 找密码框 + 其对应的账号框。填充仅针对单密码登录表单；改密页会优先保存
// autocomplete=new-password 字段，缺少语义标记时使用最后一个密码框。
// 遍历主文档及所有同源 iframe。
const locateFields = (
  preferredForm: HTMLFormElement | null = null,
): LocatedFields => {
  const docs = collectDocs(window, []);
  let fallback: LocatedFields | null = null;
  for (const doc of docs) {
    if (preferredForm && preferredForm.ownerDocument !== doc) continue;
    const all = Array.from(doc.querySelectorAll('input')) as HTMLInputElement[];
    const visible = all.filter((el) => isVisible(el));
    const scopes: HTMLInputElement[][] = [];
    const seenForms = new Set<HTMLFormElement>();
    const addForm = (form: HTMLFormElement | null) => {
      if (!form || seenForms.has(form)) return;
      const formInputs = (
        Array.from(form.querySelectorAll('input')) as HTMLInputElement[]
      ).filter((el) => isVisible(el));
      if (!formInputs.some((el) => classify(el) === 'password')) return;
      seenForms.add(form);
      scopes.push(formInputs);
    };
    if (preferredForm) {
      addForm(preferredForm);
    } else {
      const active = doc.activeElement as HTMLInputElement | null;
      if (active?.tagName === 'INPUT') addForm(active.form);
      visible.forEach((el) => {
        if (classify(el) === 'password') addForm(el.form);
      });
      const unowned = visible.filter((el) => !el.form);
      if (unowned.some((el) => classify(el) === 'password')) {
        scopes.push(unowned);
      }
    }
    if (!preferredForm && scopes.length === 0) scopes.push(visible);

    for (const scope of scopes) {
      const passwords = scope.filter((el) => classify(el) === 'password');
      // 部分密码组件用 type=text 镜像框显示明文，其密码语义会产生额外候选；
      // 登录识别应优先统计真实的 password 类型输入框。
      const typedPasswords = passwords.filter(
        (el) =>
          (el.getAttribute('type') || el.type || 'text').toLowerCase() ===
          'password',
      );
      const firstPassword = typedPasswords[0] || passwords[0] || null;
      if (!firstPassword) continue;

      const newPassword = passwords.find((el) =>
        autocompleteTokensOf(el).includes('new-password'),
      );
      const confirmationPassword =
        passwords.find(isConfirmationPassword) || null;
      const currentPassword = passwords.find((el) =>
        autocompleteTokensOf(el).includes('current-password'),
      );
      const hasSingleRealPassword =
        typedPasswords.length === 1 ||
        (typedPasswords.length === 0 && passwords.length === 1);
      const isLoginForm =
        !confirmationPassword &&
        (!!currentPassword ||
          (hasSingleRealPassword &&
            (!newPassword || isMislabeledLoginPassword(firstPassword))));
      const password =
        (isLoginForm && (currentPassword || firstPassword)) || firstPassword;
      const confirmationIndex = confirmationPassword
        ? passwords.indexOf(confirmationPassword)
        : -1;
      const passwordBeforeConfirmation =
        confirmationIndex > 0 ? passwords[confirmationIndex - 1] : null;
      const savePassword =
        newPassword ||
        passwordBeforeConfirmation ||
        passwords[passwords.length - 1] ||
        null;

      const visiblePasswordIndex = scope.indexOf(password);
      // 无 form 的 SPA 只在密码框附近搜索，避免命中页脚订阅/邀请邮箱框。
      const fieldScope = password.form
        ? (
            Array.from(
              password.form.querySelectorAll('input'),
            ) as HTMLInputElement[]
          ).filter((el) => isVisible(el))
        : scope.slice(
            Math.max(0, visiblePasswordIndex - 4),
            visiblePasswordIndex + 5,
          );
      const pIdx = fieldScope.indexOf(password);
      let username: HTMLInputElement | null = null;
      // 向前找已分类的 login 字段
      for (let i = pIdx - 1; i >= 0; i--) {
        if (isExplicitUsernameCandidate(fieldScope[i])) {
          username = fieldScope[i];
          break;
        }
      }
      // 先检查密码框后的强语义账号字段，再考虑前方的弱候选。
      if (!username) {
        for (let i = pIdx + 1; i < fieldScope.length; i++) {
          if (isExplicitUsernameCandidate(fieldScope[i])) {
            username = fieldScope[i];
            break;
          }
        }
      }
      // 兜底仅接受普通文本/邮箱/手机号，排除验证码、搜索框等无关字段。
      if (!username) {
        for (let i = pIdx - 1; i >= 0; i--) {
          if (isUsernameFallbackCandidate(fieldScope[i])) {
            username = fieldScope[i];
            break;
          }
        }
      }
      if (!username) {
        for (let i = pIdx + 1; i < fieldScope.length; i++) {
          if (isUsernameFallbackCandidate(fieldScope[i])) {
            username = fieldScope[i];
            break;
          }
        }
      }
      const located = {
        password,
        username,
        savePassword,
        confirmationPassword,
        isLoginForm,
      };
      if (isLoginForm) return located;
      if (!fallback) fallback = located;
    }
  }
  return (
    fallback || {
      password: null,
      username: null,
      savePassword: null,
      confirmationPassword: null,
      isLoginForm: false,
    }
  );
};

// 页内多账号下拉。玻璃拟态风格,支持遮罩密码 + 单条删除 + 「去管理」页脚。
// 视觉对齐 huliantest content.js。
class Dropdown {
  private ul: HTMLUListElement | null = null;
  private anchor: HTMLInputElement | null = null;
  private ownerDocument: Document | null = null;
  private ownerOutsideHandler: ((event: MouseEvent) => void) | null = null;
  public onDelete: (c: Credential) => void = () => {};
  public onManage: () => void = () => {};

  public hide = () => {
    if (this.ul && this.ul.parentNode) {
      this.ul.parentNode.removeChild(this.ul);
    }
    this.ul = null;
    this.anchor = null;
    if (this.ownerDocument && this.ownerOutsideHandler) {
      this.ownerDocument.removeEventListener(
        'mousedown',
        this.ownerOutsideHandler,
        true,
      );
    }
    this.ownerDocument = null;
    this.ownerOutsideHandler = null;
  };

  public get visible() {
    return !!this.ul;
  }

  public contains(node: any) {
    return !!this.ul && this.ul.contains(node);
  }

  public show(
    anchor: HTMLInputElement,
    creds: Credential[],
    onPick: (c: Credential) => void,
  ) {
    this.hide();
    if (creds.length === 0) return;
    this.anchor = anchor;

    const ownerDocument = anchor.ownerDocument || document;
    const ownerWindow = ownerDocument.defaultView || window;
    const ul = ownerDocument.createElement('ul');
    ul.id = '__rainsee_pw_suggest';
    const r = anchor.getBoundingClientRect();
    Object.assign(ul.style, {
      position: 'absolute',
      left: `${ownerWindow.scrollX + r.left}px`,
      top: `${ownerWindow.scrollY + r.bottom + 6}px`,
      minWidth: `${Math.max(r.width, 240)}px`,
      maxWidth: '340px',
      maxHeight: '300px',
      overflowY: 'auto',
      boxSizing: 'border-box',
      margin: '0',
      padding: '6px',
      listStyle: 'none',
      background: 'rgba(255, 255, 255, 0.78)',
      backdropFilter: 'blur(12px)',
      webkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.5)',
      borderRadius: '14px',
      boxShadow: '0 8px 32px rgba(31, 38, 135, 0.18)',
      zIndex: '2147483647',
      fontSize: '13px',
      color: '#222',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as any);

    creds.forEach((c) => ul.appendChild(this.makeItem(c, onPick)));
    ul.appendChild(this.makeFooter());
    ownerDocument.body.appendChild(ul);
    this.ul = ul;
    if (ownerDocument !== document) {
      this.ownerDocument = ownerDocument;
      this.ownerOutsideHandler = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (target && !ul.contains(target)) this.hide();
      };
      ownerDocument.addEventListener(
        'mousedown',
        this.ownerOutsideHandler,
        true,
      );
    }
  }

  private mask(pwd: string): string {
    if (!pwd) return '';
    if (pwd.length <= 2) return '*'.repeat(pwd.length);
    let m = pwd.substring(0, 2) + '*'.repeat(pwd.length - 2);
    if (m.length > 8) m = m.substring(0, 8) + '...';
    return m;
  }

  private makeItem(c: Credential, onPick: (c: Credential) => void) {
    const li = document.createElement('li');
    Object.assign(li.style, {
      padding: '9px 12px',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: '9px',
      margin: '2px 0',
      transition: 'background 0.18s ease',
      listStyle: 'none',
    } as any);
    li.addEventListener(
      'mouseenter',
      () => (li.style.background = 'rgba(59, 130, 246, 0.12)'),
    );
    li.addEventListener(
      'mouseleave',
      () => (li.style.background = 'transparent'),
    );

    // 左侧:用户名 + 遮罩密码
    const info = document.createElement('div');
    Object.assign(info.style, {
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    } as any);

    const name = document.createElement('span');
    name.textContent = c.username || '(无用户名)';
    Object.assign(name.style, {
      fontWeight: '500',
      color: '#333',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as any);
    info.appendChild(name);

    if (c.password) {
      const pw = document.createElement('span');
      pw.textContent = this.mask(c.password);
      Object.assign(pw.style, {
        color: '#888',
        fontSize: '12px',
        marginTop: '2px',
      } as any);
      info.appendChild(pw);
    }
    li.appendChild(info);

    // 右侧:删除按钮
    const del = document.createElement('span');
    del.innerHTML = '&times;';
    del.title = '删除这条记录';
    Object.assign(del.style, {
      color: '#bbb',
      fontSize: '18px',
      lineHeight: '1',
      padding: '0 6px',
      marginLeft: '10px',
      cursor: 'pointer',
      transition: 'color 0.18s ease',
    } as any);
    del.addEventListener('mouseenter', () => (del.style.color = '#ff4d4f'));
    del.addEventListener('mouseleave', () => (del.style.color = '#bbb'));
    del.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.confirm('确定要删除这条记录吗?')) {
        this.onDelete(c);
      }
    });
    li.appendChild(del);

    // 点击行填充(mousedown 抢在 blur 前)
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onPick(c);
      this.hide();
    });
    return li;
  }

  // 页脚:「去管理」(替换原 power by 文案),点击打开 设置-密码填充
  private makeFooter() {
    const li = document.createElement('li');
    li.textContent = '去管理';
    Object.assign(li.style, {
      padding: '9px 10px',
      marginTop: '4px',
      textAlign: 'center',
      fontSize: '12px',
      fontWeight: '500',
      letterSpacing: '0.5px',
      color: '#3b82f6',
      cursor: 'pointer',
      borderTop: '1px solid rgba(0,0,0,0.06)',
      borderRadius: '0 0 9px 9px',
      transition: 'background 0.18s ease',
      listStyle: 'none',
    } as any);
    li.addEventListener(
      'mouseenter',
      () => (li.style.background = 'rgba(59, 130, 246, 0.1)'),
    );
    li.addEventListener(
      'mouseleave',
      () => (li.style.background = 'transparent'),
    );
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onManage();
      this.hide();
    });
    return li;
  }
}

// 自动填充引擎(单例)。取代旧的"基于 <form> + name 属性"实现。
class AutoCompleteEngine {
  private creds: Credential[] = [];
  private filled: Credential | null = null;
  private dropdown = new Dropdown();
  private observer: MutationObserver | null = null;
  private bound = new WeakSet<HTMLInputElement>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private userEditedSignatures = new WeakMap<
    HTMLInputElement,
    Set<string>
  >();
  private filledFieldSignatures = new WeakMap<
    HTMLInputElement,
    Set<string>
  >();
  private pendingCredential: {
    username: string;
    password: string;
    url: string;
  } | null = null;
  private lastSentSignature = '';
  private lastSentAt = 0;

  public constructor() {
    ipcRenderer.on('credentials-saved', (_event, data: IFormFillData) => {
      if (!data || !data.fields) return;
      const next: Credential = {
        id: data._id || '',
        username: data.fields.username || '',
        password: data.fields.password || '',
        host: data.url || '',
      };
      const index = this.creds.findIndex((item) => item.id === next.id);
      if (index >= 0) this.creds[index] = next;
      else this.creds.unshift(next);
      this.filled = next;
      this.pendingCredential = null;
    });
    ipcRenderer.on('credentials-prompt-dismissed', () => {
      this.pendingCredential = null;
    });

    // 下拉删除/去管理回调
    this.dropdown.onDelete = (c) => this.deleteCred(c);
    this.dropdown.onManage = () => {
      ipcRenderer.send(`open-password-settings-${windowId}`);
    };

    document.addEventListener('mousedown', (e) => {
      // 点到下拉以外的地方收起
      const t = e.target as HTMLElement;
      if (
        !t ||
        (t.id !== '__rainsee_pw_suggest' && !t.closest('#__rainsee_pw_suggest'))
      ) {
        this.dropdown.hide();
      }
    });
    document.addEventListener(
      'input',
      (event) => {
        this.pendingCredential = null;
        if (event.isTrusted && event.target instanceof HTMLInputElement) {
          this.rememberFieldSignature(
            this.userEditedSignatures,
            event.target,
          );
        }
      },
      true,
    );
    // 登录方式切换通常会先聚焦新账号框,再异步更新 DOM。聚焦后补一次扫描,
    // 确保手机号/邮箱字段切换时重新绑定并填充当前可见字段。
    document.addEventListener(
      'focusin',
      (event) => {
        if (event.target instanceof HTMLInputElement) this.scheduleApply();
      },
      true,
    );

    // 先捕获字段快照再保存。很多 SPA 会在 click/submit 同一轮事件中移除表单，
    // 若等到 pagehide 才读 DOM，账号密码已经不存在。
    document.addEventListener(
      'submit',
      (event) => {
        const target = event.target as HTMLFormElement | null;
        const form = target?.tagName === 'FORM' ? target : null;
        this.captureCredential(form);
        this.trySave(form);
      },
      true,
    );
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!isLikelySubmitControl(target)) return;
        const form = target?.closest('form') as HTMLFormElement | null;
        this.captureCredential(form);
        // 给页面自己的校验/提交处理留出一轮事件，避免点击登录按钮尚未提交时
        // 就弹出保存提示；原生 form 仍由 submit 捕获路径立即处理。
        setTimeout(() => this.trySave(form), 400);
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        const target = event.target as HTMLInputElement | null;
        const form = target?.form || null;
        this.captureCredential(form);
        setTimeout(() => this.trySave(form), 400);
      },
      true,
    );
    window.addEventListener('beforeunload', () => this.trySave());
    window.addEventListener('pagehide', () => this.trySave());
    this.bindHistorySave();
  }

  // 入口(view-preload 在 load 时调用,等同旧 loadForms)
  public loadForms = () => {
    this.run();
    this.startObserver();
  };

  public onWindowMouseDown = () => {
    this.dropdown.hide();
  };

  // 部分改密页以 SPA 路由替代表单提交，路由切换前页面字段仍可读取。
  private bindHistorySave() {
    const history = window.history;
    (['pushState', 'replaceState'] as const).forEach((method) => {
      const original = history[method];
      history[method] = ((...args: any[]) => {
        this.trySave();
        return original.apply(history, args as any);
      }) as typeof history[typeof method];
    });
  }

  // 拉取本站候选 + 扫描页面 + 填充
  private async run() {
    try {
      // 把页面 hostname 作为参数传入:主进程据此匹配,不再依赖 viewManager.selected,
      // 避免后台标签 / load 瞬间 selected 尚未切换导致取到别的页面 hostname。
      const res = await ipcRenderer.invoke(
        `find-form-fill-update-${windowId}`,
        window.location.hostname,
      );
      const list: IFormFillData[] = Array.isArray(res) ? res : res ? [res] : [];
      this.creds = list
        .filter((r) => r && r.fields)
        .map((r) => ({
          id: r._id || '',
          username: r.fields.username || '',
          password: r.fields.password || '',
          host: r.url || '',
        }))
        .filter((c) => c.password || c.username);
      console.log(
        '[autofill] run host=',
        window.location.hostname,
        'creds=',
        this.creds.length,
      );
    } catch (e) {
      this.creds = [];
    }
    this.applyToPage();
  }

  // 把候选应用到页面:绑定焦点下拉、首条自动填充
  private applyToPage() {
    const { password, username, isLoginForm } = locateFields();
    if (!password) return; // 没有密码框 = 不是登录表单

    // 改密/注册表单的密码框不展示候选，也不能自动写入旧密码。
    if (!isLoginForm) return;

    // 绑定下拉(账号框 + 密码框聚焦都弹),仅绑一次
    [username, password].forEach((el) => {
      if (el) this.bindDropdown(el);
    });

    if (this.creds.length === 0) return;

    // 多账号必须让用户选择，不能把排序第一条当成“正确账号”。
    if (this.creds.length !== 1) return;

    // 单账号自动填充(仅在字段为空时,避免覆盖用户输入)
    const best = this.creds[0];
    this.fillAutomatically(username, best.username);
    this.fillAutomatically(password, best.password);
    this.filled = best;
  }

  private fieldSignature(el: HTMLInputElement) {
    const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
    return [
      classify(el) === 'password' ? 'password' : type,
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('autocomplete') || '',
    ]
      .join('\n')
      .toLowerCase();
  }

  private fillAutomatically(el: HTMLInputElement | null, value: string) {
    if (!el || !value || el.value) return;
    const signature = this.fieldSignature(el);
    if (this.userEditedSignatures.get(el)?.has(signature)) return;
    if (this.filledFieldSignatures.get(el)?.has(signature)) return;
    setValue(el, value);
    this.rememberFieldSignature(this.filledFieldSignatures, el);
  }

  private fillField(el: HTMLInputElement | null, value: string) {
    if (!el || !value) return;
    this.userEditedSignatures.delete(el);
    setValue(el, value);
    this.rememberFieldSignature(this.filledFieldSignatures, el);
  }

  private rememberFieldSignature(
    store: WeakMap<HTMLInputElement, Set<string>>,
    el: HTMLInputElement,
  ) {
    const signatures = store.get(el) || new Set<string>();
    signatures.add(this.fieldSignature(el));
    store.set(el, signatures);
  }

  private bindDropdown(el: HTMLInputElement) {
    if (this.bound.has(el)) return;
    this.bound.add(el);

    const open = () => {
      // 有候选就弹(单账号也弹,便于删除/去管理)
      if (this.creds.length === 0) return;
      const fields = locateFields();
      if (
        !fields.isLoginForm ||
        (el !== fields.username && el !== fields.password)
      ) {
        return;
      }
      this.dropdown.show(el, this.creds, (c) => this.fillPair(c));
    };
    el.addEventListener('focus', open);
    el.addEventListener('click', open);
  }

  // 选中某账号:同时填账号 + 密码
  private fillPair(c: Credential) {
    const { password, username, isLoginForm } = locateFields();
    if (!isLoginForm) return;
    this.fillField(username, c.username);
    this.fillField(password, c.password);
    this.filled = c;
  }

  // 删除某条候选:本地列表移除 + 通知主进程删库,下拉同步刷新
  private deleteCred(c: Credential) {
    if (c.id) {
      ipcRenderer.send(`credentials-delete-${windowId}`, c.id);
    }
    this.creds = this.creds.filter((x) => x !== c);
    if (this.filled === c) this.filled = null;
    this.dropdown.hide();
  }

  private readCredential(form: HTMLFormElement | null = null) {
    try {
      const { savePassword, confirmationPassword, username } =
        locateFields(form);
      const password = savePassword;
      if (!password) return null;
      const u = username ? username.value : '';
      const p = password.value;
      if (!p) return null;
      if (confirmationPassword && confirmationPassword.value !== p) return null;
      return { username: u, password: p, url: window.location.href };
    } catch (e) {
      return null;
    }
  }

  private captureCredential(form: HTMLFormElement | null = null) {
    const credential = this.readCredential(form);
    if (credential) this.pendingCredential = credential;
    return credential;
  }

  // 保存/更新:优先读当前字段，DOM 已被站点移除时使用提交前快照。
  private trySave(form: HTMLFormElement | null = null) {
    try {
      const captured = this.captureCredential(form) || this.pendingCredential;
      this.pendingCredential = null;
      if (!captured) return;
      const { username: u, password: p, url } = captured;

      // 与上次填充一致则不重复保存
      if (
        this.filled &&
        this.filled.username === u &&
        this.filled.password === p
      ) {
        return;
      }
      const existing =
        this.creds.find((c) => c.username === u) ||
        (!u && this.creds.length === 1 ? this.creds[0] : null);

      // 无用户名且本站保存了多个账号时无法可靠归属，不能新建空用户名记录。
      if (!u && !existing && this.creds.length > 1) return;

      // submit/click/pagehide 可能连续触发，只显示一次保存或更新提示。
      const signature = `${url}\n${u}\n${p}\n${existing ? existing.id : ''}`;
      const now = Date.now();
      if (
        signature === this.lastSentSignature &&
        now - this.lastSentAt < 5000
      ) {
        return;
      }
      this.lastSentSignature = signature;
      this.lastSentAt = now;

      ipcRenderer.send(`credentials-show-${windowId}`, {
        username: u,
        password: p,
        url,
        content: existing ? 'update' : 'save',
        credentialId: existing ? existing.id : '',
      });
    } catch (e) {}
  }

  // SPA 登录框可能在访问页面很久后才出现，监听保持到文档销毁。
  private startObserver() {
    if (this.observer) return;
    this.observer = new MutationObserver(() => {
      this.scheduleApply(200);
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      // 许多登录页通过 style/hidden/aria-hidden 在手机号和邮箱表单间切换,
      // 输入节点本身不变时也必须触发重新定位。
      attributeFilter: [
        'type',
        'name',
        'autocomplete',
        'class',
        'style',
        'hidden',
        'aria-hidden',
        'disabled',
      ],
    });
  }

  private scheduleApply(delay = 0) {
    if (this.scanTimer) {
      if (delay > 0) return;
      clearTimeout(this.scanTimer);
    }
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.applyToPage();
    }, delay);
  }
}

export default new AutoCompleteEngine();
