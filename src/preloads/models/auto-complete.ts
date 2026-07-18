import { ipcRenderer } from 'electron';

import { IFormFillData } from '~/interfaces';
import { windowId } from '../view-preload';

// 字段分类关键词表(中英文),对齐鸿蒙 AutoFillUtil.inject 注入脚本的 m 表。
// 命中任意一个属性值即归类。顺序:password 最强,其次 login_name。
const KW_PASSWORD = ['passwd', 'password', '密码', 'pwd'];
const KW_LOGIN = [
  'username', 'user', 'account', 'login', 'usr', 'nick', 'email', 'phone',
  'mobile', 'tel', 'name', 'sign', '用户名', '账号', '帐号', '邮箱', '手机',
];

type FieldKind = 'password' | 'login' | 'none';

// 验证码字段排除关键词(对齐 huliantest content.js),避免把验证码框当账号框
const KW_CAPTCHA = ['captcha', 'verifycode', 'checkcode', 'vcode', '验证码'];

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
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
};

// 分类器:照搬鸿蒙 c(el) —— type=password 强信号 → 遍历【所有属性】+ 关键词 → type 兜底
const classify = (el: HTMLInputElement): FieldKind => {
  const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
  if (type === 'password') return 'password';
  if (type === 'hidden' || type === 'submit' || type === 'button'
    || type === 'checkbox' || type === 'radio' || type === 'file') {
    return 'none';
  }

  // 排除验证码框(placeholder/name 命中验证码关键词),否则会误填账号
  const ph = (el.getAttribute('placeholder') || '').toLowerCase();
  const nm = (el.getAttribute('name') || '').toLowerCase();
  for (const kw of KW_CAPTCHA) {
    if (ph.indexOf(kw) >= 0 || nm.indexOf(kw) >= 0) return 'none';
  }
  if (nm === 'code') return 'none';

  // 遍历元素所有属性(name/id/placeholder/aria-label/autocomplete/class...),跳过 value
  const attrs = el.attributes;
  const hit = (kws: string[]): boolean => {
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (attr.name === 'value') continue;
      const v = (attr.value || '').toLowerCase();
      if (!v) continue;
      for (const kw of kws) {
        if (v.indexOf(kw) >= 0) return true;
      }
    }
    return false;
  };
  if (hit(KW_PASSWORD)) return 'password';
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

// 找密码框 + 其对应的账号框。账号框优先取密码框【之前】最近的 login 字段,
// 找不到再退而取密码框前最近的任意可见 text/email/tel。
const locateFields = (): {
  password: HTMLInputElement | null;
  username: HTMLInputElement | null;
} => {
  const all = Array.from(
    document.querySelectorAll('input'),
  ) as HTMLInputElement[];
  const visible = all.filter((el) => isVisible(el));

  const password = visible.find((el) => classify(el) === 'password') || null;
  if (!password) return { password: null, username: null };

  const pIdx = visible.indexOf(password);
  let username: HTMLInputElement | null = null;
  // 向前找已分类的 login 字段
  for (let i = pIdx - 1; i >= 0; i--) {
    if (classify(visible[i]) === 'login') { username = visible[i]; break; }
  }
  // 兜底:密码框前最近的非密码可见输入框
  if (!username) {
    for (let i = pIdx - 1; i >= 0; i--) {
      const t = (visible[i].getAttribute('type') || 'text').toLowerCase();
      if (t !== 'password') { username = visible[i]; break; }
    }
  }
  return { password, username };
};

// 页内多账号下拉。玻璃拟态风格,支持遮罩密码 + 单条删除 + 「去管理」页脚。
// 视觉对齐 huliantest content.js。
class Dropdown {
  private ul: HTMLUListElement | null = null;
  private anchor: HTMLInputElement | null = null;
  public onDelete: (c: Credential) => void = () => {};
  public onManage: () => void = () => {};

  public hide = () => {
    if (this.ul && this.ul.parentNode) {
      this.ul.parentNode.removeChild(this.ul);
    }
    this.ul = null;
    this.anchor = null;
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

    const ul = document.createElement('ul');
    ul.id = '__rainsee_pw_suggest';
    const r = anchor.getBoundingClientRect();
    Object.assign(ul.style, {
      position: 'absolute',
      left: `${window.scrollX + r.left}px`,
      top: `${window.scrollY + r.bottom + 6}px`,
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
    document.body.appendChild(ul);
    this.ul = ul;
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
  private scanScheduled = false;

  public constructor() {
    ipcRenderer.on('check-form-autofill', () => this.run());

    // 下拉删除/去管理回调
    this.dropdown.onDelete = (c) => this.deleteCred(c);
    this.dropdown.onManage = () => {
      ipcRenderer.send(`open-password-settings-${windowId}`);
    };

    document.addEventListener('mousedown', (e) => {
      // 点到下拉以外的地方收起
      const t = e.target as HTMLElement;
      if (!t || (t.id !== '__rainsee_pw_suggest' && !t.closest('#__rainsee_pw_suggest'))) {
        this.dropdown.hide();
      }
    });

    // 保存:提交 / 离开页面时回传当前账号密码
    document.addEventListener('submit', () => this.trySave(), true);
    window.addEventListener('beforeunload', () => this.trySave());
  }

  // 入口(view-preload 在 load 时调用,等同旧 loadForms)
  public loadForms = () => {
    this.run();
    this.startObserver();
  };

  public onWindowMouseDown = () => {
    this.dropdown.hide();
  };

  // 拉取本站候选 + 扫描页面 + 填充
  private async run() {
    try {
      const res = await ipcRenderer.invoke(`find-form-fill-update-${windowId}`);
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
    } catch (e) {
      this.creds = [];
    }
    this.applyToPage();
  }

  // 把候选应用到页面:绑定焦点下拉、首条自动填充
  private applyToPage() {
    const { password, username } = locateFields();
    if (!password) return; // 没有密码框 = 不是登录表单

    // 绑定下拉(账号框 + 密码框聚焦都弹),仅绑一次
    [username, password].forEach((el) => {
      if (el) this.bindDropdown(el);
    });

    if (this.creds.length === 0) return;

    // 首条自动填充(仅在字段为空时,避免覆盖用户输入),取最佳匹配(数组首个)
    const best = this.creds[0];
    if (username && best.username && !username.value) {
      setValue(username, best.username);
    }
    if (password && best.password && !password.value) {
      setValue(password, best.password);
    }
    this.filled = best;
  }

  private bindDropdown(el: HTMLInputElement) {
    if (this.bound.has(el)) return;
    this.bound.add(el);

    const open = () => {
      // 有候选就弹(单账号也弹,便于删除/去管理)
      if (this.creds.length === 0) return;
      this.dropdown.show(el, this.creds, (c) => this.fillPair(c));
    };
    el.addEventListener('focus', open);
    el.addEventListener('click', open);
  }

  // 选中某账号:同时填账号 + 密码
  private fillPair(c: Credential) {
    const { password, username } = locateFields();
    if (username && c.username) setValue(username, c.username);
    if (password && c.password) setValue(password, c.password);
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

  // 保存/更新:读当前账号密码,与已填充的对比,回传主进程
  private trySave() {
    try {
      const { password, username } = locateFields();
      if (!password) return;
      const u = username ? username.value : '';
      const p = password.value;
      if (!p) return; // 没填密码不存

      // 与上次填充一致则不重复保存
      if (this.filled && this.filled.username === u && this.filled.password === p) {
        return;
      }
      const isUpdate = this.creds.some((c) => c.username === u);

      ipcRenderer.send(`credentials-show-${windowId}`, {
        username: u,
        password: p,
        url: window.location.href,
        content: isUpdate ? 'update' : 'save',
        oldUsername: this.filled ? this.filled.username : u,
      });
    } catch (e) {}
  }

  // SPA 晚渲染兜底:监听 DOM 变化,出现登录表单时补扫;成功或超时后断开
  private startObserver() {
    if (this.observer) return;
    let tries = 0;
    const started = Date.now();
    this.observer = new MutationObserver(() => {
      if (this.scanScheduled) return;
      this.scanScheduled = true;
      setTimeout(() => {
        this.scanScheduled = false;
        tries++;
        if (locateFields().password) this.applyToPage();
        // 最多扫 15 次或 20s,避免长期占用
        if (tries >= 15 || Date.now() - started > 20000) {
          this.observer && this.observer.disconnect();
          this.observer = null;
        }
      }, 500);
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

export default new AutoCompleteEngine();
