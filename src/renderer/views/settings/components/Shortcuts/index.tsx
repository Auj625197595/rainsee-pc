import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { ipcRenderer } from '~/common/renderer-ipc';
import store from '../../store';
import { Header, Title, SecondaryText } from '../App/style';
import { NormalButton } from '../App';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';

// 主进程 get-shortcut-actions 下发的数据结构(无需 import 主进程注册表,
// 避免把 src/main 模块拖进 renderer bundle)。
interface ShortcutActionDTO {
  id: string;
  label: string;
  category: string;
  defaults: string[];
  accelerators: string[];
}
interface ShortcutCategoryDTO {
  id: string;
  label: string;
}

// 扩展命令(chrome.commands)快照(主进程 get-extension-shortcuts 下发)。
interface ExtCommandDTO {
  name: string;
  description?: string;
  shortcut: string; // 覆盖后当前生效;'' 无快捷键
  defaultShortcut: string; // manifest 平台默认
  isExecuteAction: boolean;
  global: boolean;
}
interface ExtGroupDTO {
  id: string;
  name: string;
  commands: ExtCommandDTO[];
}

// ===========================================================================
// accelerator 与按键捕获工具
// ===========================================================================

// KeyboardEvent.code → Electron accelerator 的 key 部分。
// 用 code 而非 key,不受大小写/输入法/布局影响。
const codeToKey = (code: string): string | null => {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];

  const numpad: Record<string, string> = {
    Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3',
    Numpad4: 'num4', Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7',
    Numpad8: 'num8', Numpad9: 'num9', NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  };
  if (numpad[code]) return numpad[code];

  // F1-F24,code 与 accelerator 同名
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  const func: Record<string, string> = {
    Space: 'Space', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Return',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  if (func[code]) return func[code];

  const punct: Record<string, string> = {
    Equal: '=', Minus: '-', Slash: '/', Semicolon: ';',
    Comma: ',', Period: '.', BracketLeft: '[', BracketRight: ']',
    Backquote: '`', Backslash: '\\',
  };
  if (punct[code]) return punct[code];

  return null;
};

// keydown → accelerator 字符串;不合法(纯修饰键/不支持的键)返回 null。
const keyEventToAccelerator = (e: KeyboardEvent): string | null => {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('CmdOrCtrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = codeToKey(e.code);
  if (!key) return null;
  const isFunctionKey = /^F\d{1,2}$/.test(key);
  // 至少一个修饰键;功能键(F1-F12)允许单独使用。
  if (mods.length === 0 && !isFunctionKey) return null;
  return [...mods, key].join('+');
};

// 比较时把等价的修饰键归一:Windows 上 Ctrl 与 CmdOrCtrl 等价,但字符串不同
// (注册表里 show-history 用 'Ctrl+H',而捕获生成 'CmdOrCtrl+H')。归一后再比,
// 避免冲突漏判与「与默认等价却显示已自定义」的误判。
const normalizeAccel = (a: string): string =>
  a.replace(/CommandOrCtrl|CmdOrCtrl/g, 'Ctrl').replace(/\bSuper\b|\bMeta\b/g, 'Win');

// accelerator → 展示文本(CmdOrCtrl → Ctrl,Super/Meta → Win)
const formatAccel = (accel: string): string => normalizeAccel(accel);
const formatAccels = (accels: string[]): string =>
  accels.map(formatAccel).join('  /  ');

const accelsEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => normalizeAccel(x) === normalizeAccel(b[i]));

// 扩展命令在捕获态的复合标识(与内置动作 id 区分):'ext::<extId>::<cmdName>'。
// extId 为扩展 id(Chrome 32 字符,不含 '::'),cmdName 为 manifest.commands 的 key。
const EXT_CAPTURE_PREFIX = 'ext::';
const extCaptureId = (extId: string, cmdName: string) =>
  `${EXT_CAPTURE_PREFIX}${extId}::${cmdName}`;
const parseExtCaptureId = (
  id: string,
): { extId: string; cmdName: string } | null => {
  if (!id.startsWith(EXT_CAPTURE_PREFIX)) return null;
  const rest = id.slice(EXT_CAPTURE_PREFIX.length);
  const idx = rest.indexOf('::');
  if (idx < 0) return null;
  return { extId: rest.slice(0, idx), cmdName: rest.slice(idx + 2) };
};

// ===========================================================================
// styled
// ===========================================================================

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;

  & > button {
    margin-left: auto;
    flex-shrink: 0;
  }
`;

const CategoryTitle = styled.div`
  margin: 22px 0 2px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

// 非交互行(不需要 Row 的 cursor:pointer 整行点击)
const ActionRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 10px;
  padding: 14px 18px;
  border-radius: 16px;
  transition: box-shadow 0.18s ease;

  ${({ theme, capturing }: { theme?: ITheme; capturing?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${capturing ? p.primary : p.line},
        0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

// 右侧控件列:按钮行在上,冲突提示在下
const ControlColumn = styled.div`
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
`;

const BtnRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ShortcutBadge = styled.button`
  min-width: 110px;
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font-family: 'SF Mono', 'Roboto Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.16s ease, box-shadow 0.16s ease,
    border-color 0.16s ease;

  ${({ theme, capturing }: { theme?: ITheme; capturing?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${capturing ? p.primary : p.textMain};
      background-color: ${capturing ? p.primarySoft : p.bg};
      border: 1px solid ${capturing ? p.primary : p.line};
      box-shadow: ${capturing ? `0 0 0 3px ${p.primary}1f` : 'none'};

      &:hover {
        border-color: ${p.primary}66;
      }
    `;
  }}
`;

const ActionButton = styled.button`
  height: 32px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.16s ease, opacity 0.16s ease;

  ${({ theme, disabled }: { theme?: ITheme; disabled?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: transparent;
      border: 1px solid ${p.line};
      opacity: ${disabled ? 0.4 : 1};
      cursor: ${disabled ? 'not-allowed' : 'pointer'};

      &:hover {
        background-color: ${disabled ? 'transparent' : p.bg};
      }
    `;
  }}
`;

const ConflictHint = styled.div`
  font-size: 12.5px;
  color: #e53935;
`;

// 扩展命令区块的小标题行(图标 + 扩展名)。带 id 供右键「快捷键设置」跳转后滚动定位。
const ExtHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;
  padding: 6px 4px 2px;
  scroll-margin-top: 16px;
  font-size: 12.5px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ExtIcon = styled.img`
  width: 16px;
  height: 16px;
  border-radius: 3px;
`;

const DisabledHint = styled.div`
  padding: 40px 0;
  text-align: center;
  font-size: 14px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

// ===========================================================================
// 组件
// ===========================================================================

export const Shortcuts = observer(() => {
  const [actions, setActions] = React.useState<ShortcutActionDTO[]>([]);
  const [categories, setCategories] = React.useState<ShortcutCategoryDTO[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [captureId, setCaptureId] = React.useState<string | null>(null);
  const [captured, setCaptured] = React.useState<string | null>(null);
  // 扩展命令快照(get-extension-shortcuts) + 扩展元数据(extensions-get-detailed 的 name/icon)
  const [extGroups, setExtGroups] = React.useState<ExtGroupDTO[]>([]);
  const [extMeta, setExtMeta] = React.useState<
    Record<string, { name: string; icon?: string }>
  >({});

  // 并发拉取:内置动作列表 + 扩展命令快照 + 扩展元数据(图标/名称)
  React.useEffect(() => {
    let alive = true;
    Promise.all([
      ipcRenderer.invoke('get-shortcut-actions'),
      ipcRenderer.invoke('get-extension-shortcuts').catch(() => []),
      ipcRenderer.invoke('extensions-get-detailed').catch(() => []),
    ])
      .then(([res, extRes, detailed]: any[]) => {
        if (!alive) return;
        setCategories(res?.categories || []);
        setActions(res?.actions || []);
        setExtGroups(extRes || []);
        const meta: Record<string, { name: string; icon?: string }> = {};
        for (const it of detailed || []) {
          meta[it.id] = { name: it.name, icon: it.icon };
        }
        setExtMeta(meta);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 重新拉取扩展命令快照(改键/恢复后,扩展命令值不在 mobx,需手动刷新)
  const refreshExtGroups = React.useCallback(async () => {
    const res = await ipcRenderer.invoke('get-extension-shortcuts').catch(() => null);
    if (res) setExtGroups(res);
  }, []);

  // 跳转定位:?ext=<id>(来自扩展图标右键「快捷键设置」)→ 滚动到该扩展区块。
  // 依赖 loaded,只在加载完成时触发一次,避免保存刷新时重复滚动。
  React.useEffect(() => {
    if (!loaded) return;
    const ext = new URLSearchParams(window.location.search).get('ext');
    if (!ext) return;
    const t = setTimeout(() => {
      document
        .getElementById(`ext-shortcuts-${ext}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [loaded]);

  // 捕获模式:进入时让设置页忽略应用菜单 accelerator,否则用户按下已绑定的
  // 组合(如 Ctrl+T)会先触发菜单动作,干扰捕获。退出/卸载时恢复。
  const capturing = captureId !== null;
  React.useEffect(() => {
    if (!capturing) return;
    ipcRenderer.invoke('shortcut-capture-mode', true);
    return () => {
      ipcRenderer.invoke('shortcut-capture-mode', false);
    };
  }, [capturing]);

  // 按键监听(仅在捕获中)
  React.useEffect(() => {
    if (captureId === null) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape' || e.key === 'Escape') {
        setCaptureId(null);
        setCaptured(null);
        return;
      }
      const accel = keyEventToAccelerator(e);
      if (accel) setCaptured(accel);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [captureId]);

  // 当前生效的 accelerators:用户覆盖优先,否则注册表默认。
  // store.settings.shortcuts 是 mobx observable,主进程 update-settings 广播后自动刷新。
  const overrides = store.settings.shortcuts || {};
  const currentAccels = (a: ShortcutActionDTO): string[] => {
    const ov = overrides[a.id];
    return Array.isArray(ov) && ov.length > 0 ? ov : a.defaults;
  };

  // 所有可绑定项的当前 accelerators(内置动作 + 扩展命令),供冲突检测统一遍历。
  const allBindings = React.useMemo(() => {
    const list: { id: string; label: string; accels: string[] }[] = [];
    for (const a of actions) {
      list.push({ id: a.id, label: a.label, accels: currentAccels(a) });
    }
    for (const g of extGroups) {
      const gName = extMeta[g.id]?.name || g.name;
      for (const c of g.commands) {
        list.push({
          id: extCaptureId(g.id, c.name),
          label: `${gName} · ${c.description || c.name}`,
          accels: c.shortcut ? [c.shortcut] : [],
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, extGroups, extMeta, overrides]);

  // 冲突检查:captured 是否已被其他绑定项占用(归一比较)
  const conflictLabel = React.useMemo(() => {
    if (!captured || !captureId) return null;
    const norm = normalizeAccel(captured);
    for (const b of allBindings) {
      if (b.id === captureId) continue;
      if (b.accels.some((x) => normalizeAccel(x) === norm)) return b.label;
    }
    return null;
  }, [captured, captureId, allBindings]);

  const startCapture = (id: string) => {
    setCaptured(null);
    setCaptureId(id);
  };

  const cancelCapture = () => {
    setCaptureId(null);
    setCaptured(null);
  };

  const saveCapture = async () => {
    if (!captureId || !captured || conflictLabel) return;
    const ext = parseExtCaptureId(captureId);
    if (ext) {
      // 扩展命令:与 manifest 默认等价则走 reset(保持 settings 干净),否则 set
      const g = extGroups.find((x) => x.id === ext.extId);
      const c = g?.commands.find((x) => x.name === ext.cmdName);
      const sameAsDefault =
        !!c &&
        !!c.defaultShortcut &&
        normalizeAccel(c.defaultShortcut) === normalizeAccel(captured);
      if (sameAsDefault) {
        await ipcRenderer.invoke('reset-extension-shortcut', ext.extId, ext.cmdName);
      } else {
        await ipcRenderer.invoke(
          'set-extension-shortcut',
          ext.extId,
          ext.cmdName,
          captured,
        );
      }
      refreshExtGroups();
    } else {
      // 内置动作:与默认等价则清覆盖,否则写覆盖
      const action = actions.find((a) => a.id === captureId);
      if (
        action &&
        action.defaults.length === 1 &&
        normalizeAccel(action.defaults[0]) === normalizeAccel(captured)
      ) {
        await ipcRenderer.invoke('reset-shortcut', captureId);
      } else {
        await ipcRenderer.invoke('set-shortcut', captureId, [captured]);
      }
    }
    setCaptureId(null);
    setCaptured(null);
  };

  const resetOne = async (id: string) => {
    await ipcRenderer.invoke('reset-shortcut', id);
  };

  const resetExt = async (extId: string, cmdName: string) => {
    await ipcRenderer.invoke('reset-extension-shortcut', extId, cmdName);
    refreshExtGroups();
  };

  const resetAll = async () => {
    await ipcRenderer.invoke('reset-shortcut');
  };

  if (!loaded) {
    return (
      <>
        <Header>快捷键</Header>
        <DisabledHint>加载中…</DisabledHint>
      </>
    );
  }

  const hasCustom = actions.some(
    (a) => !accelsEqual(currentAccels(a), a.defaults),
  );

  return (
    <>
      <Header>快捷键</Header>
      <TopRow>
        <SecondaryText>
          点击右侧按键即可修改,按 Esc 取消捕获。功能键(F1-F12)可单独使用,
          其他键需配合 Ctrl / Alt / Shift。下方「扩展命令」区块可覆盖各扩展声明的快捷键。
        </SecondaryText>
        {hasCustom && <NormalButton variant="soft" onClick={resetAll}>恢复全部默认</NormalButton>}
      </TopRow>

      {categories.map((cat) => {
        const items = actions.filter((a) => a.category === cat.id);
        if (items.length === 0) return null;
        return (
          <React.Fragment key={cat.id}>
            <CategoryTitle>{cat.label}</CategoryTitle>
            {items.map((a) => {
              const isCapturing = captureId === a.id;
              const isCustom = !accelsEqual(currentAccels(a), a.defaults);
              const conflict = isCapturing && captured ? conflictLabel : null;
              return (
                <ActionRow key={a.id} capturing={isCapturing}>
                  <Title>{a.label}</Title>
                  <ControlColumn>
                    <BtnRow>
                      {isCapturing ? (
                        <>
                          <ShortcutBadge capturing>
                            {captured ? formatAccel(captured) : '按下快捷键…'}
                          </ShortcutBadge>
                          <ActionButton
                            disabled={!!conflict || !captured}
                            onClick={saveCapture}
                          >
                            保存
                          </ActionButton>
                          <ActionButton onClick={cancelCapture}>取消</ActionButton>
                        </>
                      ) : (
                        <>
                          <ShortcutBadge onClick={() => startCapture(a.id)}>
                            {formatAccels(currentAccels(a)) || '未设置'}
                          </ShortcutBadge>
                          {isCustom && (
                            <ActionButton onClick={() => resetOne(a.id)}>
                              恢复默认
                            </ActionButton>
                          )}
                        </>
                      )}
                    </BtnRow>
                    {conflict && (
                      <ConflictHint>
                        与「{conflict}」冲突,请选择其他按键
                      </ConflictHint>
                    )}
                  </ControlColumn>
                </ActionRow>
              );
            })}
          </React.Fragment>
        );
      })}

      {extGroups.length > 0 && (
        <>
          <CategoryTitle>扩展命令</CategoryTitle>
          {extGroups.map((g) => {
            const meta = extMeta[g.id] || { name: g.name };
            return (
              <React.Fragment key={g.id}>
                <ExtHeader id={`ext-shortcuts-${g.id}`}>
                  {meta.icon && <ExtIcon src={meta.icon} />}
                  <span>{meta.name}</span>
                </ExtHeader>
                {g.commands.map((c) => {
                  const cid = extCaptureId(g.id, c.name);
                  const isCapturing = captureId === cid;
                  const isCustom =
                    !!c.defaultShortcut &&
                    normalizeAccel(c.shortcut || '') !==
                      normalizeAccel(c.defaultShortcut);
                  const conflict = isCapturing && captured ? conflictLabel : null;
                  return (
                    <ActionRow key={cid} capturing={isCapturing}>
                      <Title>{c.description || c.name}</Title>
                      <ControlColumn>
                        <BtnRow>
                          {isCapturing ? (
                            <>
                              <ShortcutBadge capturing>
                                {captured ? formatAccel(captured) : '按下快捷键…'}
                              </ShortcutBadge>
                              <ActionButton
                                disabled={!!conflict || !captured}
                                onClick={saveCapture}
                              >
                                保存
                              </ActionButton>
                              <ActionButton onClick={cancelCapture}>取消</ActionButton>
                            </>
                          ) : (
                            <>
                              <ShortcutBadge onClick={() => startCapture(cid)}>
                                {c.shortcut ? formatAccel(c.shortcut) : '未设置'}
                              </ShortcutBadge>
                              {isCustom && (
                                <ActionButton onClick={() => resetExt(g.id, c.name)}>
                                  恢复默认
                                </ActionButton>
                              )}
                            </>
                          )}
                        </BtnRow>
                        {conflict && (
                          <ConflictHint>
                            与「{conflict}」冲突,请选择其他按键
                          </ConflictHint>
                        )}
                      </ControlColumn>
                    </ActionRow>
                  );
                })}
              </React.Fragment>
            );
          })}
        </>
      )}
    </>
  );
});
