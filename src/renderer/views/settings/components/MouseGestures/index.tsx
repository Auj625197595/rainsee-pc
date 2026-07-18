import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { ipcRenderer } from '~/common/renderer-ipc';
import store from '../../store';
import { Header, Title, SecondaryText } from '../App/style';
import { NormalButton } from '../App';
import { Switch } from '~/renderer/components/Switch';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';

// 主进程 get-gesture-actions 下发的数据结构(不 import 主进程注册表,避免把
// src/main 模块拖进 renderer bundle)。
interface GestureActionDTO {
  id: string;
  label: string;
  category: string;
}
interface GestureCategoryDTO {
  id: string;
  label: string;
}
interface PresetShapeDTO {
  code: string;
  label: string;
}
interface BindingDTO {
  id: string;
  shape: string | null;
  defaultShape: string | null;
}

// ===========================================================================
// 形状 → 迷你 SVG 字形(下拉项/当前值旁边显示手势形状)
// ===========================================================================

// 方向 → 单位向量(SVG 坐标,y 向下为正)。只有 4 个基向:形状由基向序列组成,
// 如 "DR"=先下再右的折角,"UD"=先上再下。
const DIR_VEC: { [k: string]: [number, number] } = {
  R: [1, 0],
  L: [-1, 0],
  U: [0, -1],
  D: [0, 1],
};

// 把 code 串按字符拆成基向 token(每个字符都是 L/R/U/D)。
const tokenize = (code: string): string[] => {
  const out: string[] = [];
  for (const ch of code || '') {
    if (DIR_VEC[ch]) out.push(ch);
  }
  return out;
};

const ShapeGlyph = ({
  code,
  size = 18,
  color = 'currentColor',
}: {
  code: string;
  size?: number;
  color?: string;
}) => {
  const tokens = tokenize(code || '');
  if (tokens.length === 0) return null;
  const step = size * 0.34;
  let x = size / 2;
  let y = size / 2;
  const pts: [number, number][] = [[x, y]];
  for (const t of tokens) {
    const v = DIR_VEC[t];
    if (!v) continue;
    x += v[0] * step;
    y += v[1] * step;
    pts.push([x, y]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ox = (size - (maxX + minX)) / 2;
  const oy = (size - (maxY + minY)) / 2;
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] + ox).toFixed(1)} ${(p[1] + oy).toFixed(1)}`)
    .join(' ');
  const start = pts[0];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
      <circle
        cx={(start[0] + ox).toFixed(1)}
        cy={(start[1] + oy).toFixed(1)}
        r="1.4"
        fill={color}
        stroke="none"
      />
    </svg>
  );
};

// ===========================================================================
// styled(克隆 Shortcuts/index.tsx 的原子,改下拉)
// ===========================================================================

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 6px;

  & > button {
    margin-left: auto;
    flex-shrink: 0;
  }
`;

const OptionsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 6px;
  margin-bottom: 8px;
  padding: 14px 18px;
  border-radius: 16px;
  flex-wrap: wrap;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const OptionItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ColorInput = styled.input`
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  &::-webkit-color-swatch {
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
  }
`;

const CategoryTitle = styled.div`
  margin: 18px 0 2px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ActionRow = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 10px;
  padding: 14px 18px;
  border-radius: 16px;
  transition: box-shadow 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const CurrentShape = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 96px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

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

const ShapeSelect = styled.select`
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        border-color: ${p.primary}66;
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
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

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: transparent;
      border: 1px solid ${p.line};

      &:hover {
        background-color: ${p.bg};
      }
    `;
  }}
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

export const MouseGestures = observer(() => {
  const [actions, setActions] = React.useState<GestureActionDTO[]>([]);
  const [categories, setCategories] = React.useState<GestureCategoryDTO[]>([]);
  const [presets, setPresets] = React.useState<PresetShapeDTO[]>([]);
  const [defaults, setDefaults] = React.useState<{ [id: string]: string | null }>({});
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    ipcRenderer
      .invoke('get-gesture-actions')
      .then((res: any) => {
        if (!alive || !res) return;
        setCategories(res.categories || []);
        setActions(res.actions || []);
        setPresets(res.presets || []);
        const d: { [id: string]: string | null } = {};
        for (const b of res.bindings || []) d[b.id] = b.defaultShape;
        setDefaults(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 用户覆盖(mobx observable)。主进程 update-settings 广播后自动刷新。
  const overrides = store.settings.mouseGestures || {};

  // 某动作当前生效的 shape:覆盖优先(含 null=解绑),否则默认。
  const effective = (id: string): string | null => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      return overrides[id] ?? null;
    }
    return defaults[id] ?? null;
  };

  // 每个动作的当前 shape(用于冲突检测:某形状是否被「别的」动作占用)。
  const usedByOther = (id: string, shape: string | null): boolean => {
    if (!shape) return false;
    return actions.some((a) => a.id !== id && effective(a.id) === shape);
  };

  const isCustom = (id: string): boolean => effective(id) !== (defaults[id] ?? null);

  const hasCustom = actions.some((a) => isCustom(a.id));

  const setShape = (id: string, shape: string | null) => {
    ipcRenderer.invoke('set-gesture', id, shape);
  };

  const resetOne = (id: string) => ipcRenderer.invoke('reset-gesture', id);
  const resetAll = () => ipcRenderer.invoke('reset-gesture');

  const setOption = (key: 'enabled' | 'color', value: any) =>
    ipcRenderer.invoke('set-gesture-option', key, value);

  const enabled = store.settings.mouseGesturesEnabled !== false;

  if (!loaded) {
    return (
      <>
        <Header>鼠标手势</Header>
        <DisabledHint>加载中…</DisabledHint>
      </>
    );
  }

  return (
    <>
      <Header>鼠标手势</Header>
      <TopRow>
        <SecondaryText>
          按住鼠标右键拖动绘制手势。在每项右侧选择手势形状,松开后触发对应动作。
          普通右键(不拖动)仍会弹出菜单。已被其他动作占用的形状不会出现在下拉里。
        </SecondaryText>
        {hasCustom && <NormalButton variant="soft" onClick={resetAll}>恢复全部默认</NormalButton>}
      </TopRow>

      <OptionsRow>
        <OptionItem>
          <Switch
            clickable
            value={enabled}
            onClick={() => setOption('enabled', !enabled)}
          />
          <span>启用手势</span>
        </OptionItem>
        <OptionItem>
          <ColorInput
            type="color"
            value={store.settings.mouseGestureColor || '#3b82f6'}
            onChange={(e) => setOption('color', e.target.value)}
          />
          <span>轨迹颜色</span>
        </OptionItem>
      </OptionsRow>

      <div style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? 'auto' : 'none' }}>
        {categories.map((cat) => {
          const items = actions.filter((a) => a.category === cat.id);
          if (items.length === 0) return null;
          return (
            <React.Fragment key={cat.id}>
              <CategoryTitle>{cat.label}</CategoryTitle>
              {items.map((a) => {
                const cur = effective(a.id);
                // 可选项:未绑定 + 当前值 + 未被别人占用的预设。
                const available = presets.filter(
                  (p) => p.code === cur || !usedByOther(a.id, p.code),
                );
                return (
                  <ActionRow key={a.id}>
                    <Title>{a.label}</Title>
                    <CurrentShape>
                      {cur ? (
                        <>
                          <ShapeGlyph code={cur} />
                          <span>{cur}</span>
                        </>
                      ) : (
                        <span style={{ opacity: 0.6 }}>未绑定</span>
                      )}
                    </CurrentShape>
                    <ControlColumn>
                      <BtnRow>
                        <ShapeSelect
                          value={cur || ''}
                          onChange={(e) =>
                            setShape(a.id, e.target.value === '' ? null : e.target.value)
                          }
                        >
                          <option value="">未绑定</option>
                          {available.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.label}
                            </option>
                          ))}
                        </ShapeSelect>
                        {isCustom(a.id) && (
                          <ActionButton onClick={() => resetOne(a.id)}>恢复默认</ActionButton>
                        )}
                      </BtnRow>
                    </ControlColumn>
                  </ActionRow>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
});
