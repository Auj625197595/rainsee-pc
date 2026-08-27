import styled, { css, keyframes } from 'styled-components';
import { ICON_MORE, ICON_EDIT } from '~/renderer/constants';
import { IconButton } from '../App/style';
import { centerIcon } from '~/renderer/mixins';
import { ITheme } from '~/interfaces';
import { getPalette } from '../../utils/palette';

// 设置项被 ?highlight= 命中时的脉冲提示(告知条「设置」按钮跳转来用)。
const highlightPulse = keyframes`
  0%, 100% { box-shadow: inset 0 0 0 1px var(--pulse-c), 0 0 0 0 var(--pulse-c); }
  50% { box-shadow: inset 0 0 0 2px var(--pulse-c), 0 0 0 6px var(--pulse-glow); }
`;

export const EnginesTable = styled.div`
  display: flex;
  flex-flow: column;
`;

export const TableRow = styled.div`
  margin-right: 0;
  display: grid;
  grid-template-columns: 5fr 4fr 38px 38px;
  line-height: 20px;
  height: 36px;
  align-items: center;

  ${({ bold, dragging }: { bold?: boolean; dragging?: boolean }) => css`
    font-weight: ${bold ? 500 : 300};
    opacity: ${dragging ? 0.4 : 1};
  `};
`;

export const TableCell = styled.div`
  display: flex;
  align-items: center;
  line-height: 26px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  padding: 0 12px;

  &:nth-child(1) {
    grid-column: 1 / auto;
  }

  &:nth-child(2) {
    grid-column: 2 / auto;
  }

  &:nth-child(3) {
    grid-column: 3 / auto;
  }

  * {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
`;

export const TableHeader = styled(TableCell)`
  opacity: 0.54;
  margin-top: 8px;
`;

export const DragHandle = styled(IconButton)`
  height: 32px;
  width: 32px;
  background-image: url(${ICON_MORE});
  grid-column: 3 / auto;
  cursor: grab;
  ${centerIcon(18)}

  &:active {
    cursor: grabbing;
  }
`;

export const EditButton = styled(IconButton)`
  height: 32px;
  width: 32px;
  background-image: url(${ICON_EDIT});
  grid-column: 4 / auto;
  ${centerIcon(18)}
`;

// 下拉项 / 选中标签的统一布局：图标 + 名称
export const EngineOption = styled.div`
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

export const EngineIcon = styled.div`
  width: 16px;
  height: 16px;
  min-width: 16px;
  margin-right: 10px;
  ${centerIcon(16)}

  ${({ icon }: { icon?: string }) => css`
    background-image: url(${icon});
  `}
`;

// ===== 分组卡片:把同类设置项收进一张卡片,行间用细分隔线区隔,
// 取代「每个设置项各占一张浮起卡片」的满屏卡片观感,让地址栏页透气、现代。=====

// 分组小标题(卡片上方独立文字,不进卡片)
export const GroupTitle = styled.div`
  margin: 24px 6px 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

// 分组容器:统一描边 + 微阴影,内含若干 GroupRow。
// 不用 overflow:hidden——下拉菜单(ContextMenu 为 absolute)会一起被裁掉。
// 改用 :first/:last 给首尾行的悬浮底色补圆角,与卡片圆角吻合。
export const Group = styled.div`
  margin-top: 6px;
  border-radius: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

// 分组内的扁平行:无独立背景/描边,靠分隔线区分;整行可点击。
// indent:作为某总开关的下级项时左缩进,体现层级;disabled:总开关关闭时置灰且不响应。
export const GroupRow = styled.div<{ indent?: boolean; disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  ${({
    theme,
    indent,
    disabled,
  }: {
    theme?: ITheme;
    indent?: boolean;
    disabled?: boolean;
  }) => {
    const p = getPalette(theme);
    return css`
      padding-left: ${indent ? 38 : 18}px;
      opacity: ${disabled ? 0.4 : 1};
      pointer-events: ${disabled ? 'none' : 'auto'};

      &:not(:last-child) {
        border-bottom: 1px solid ${p.line};
      }
      &:first-child {
        border-top-left-radius: 18px;
        border-top-right-radius: 18px;
      }
      &:last-child {
        border-bottom-left-radius: 18px;
        border-bottom-right-radius: 18px;
      }

      &:hover {
        background-color: ${p.bg};
      }
    `;
  }}
`;

// 非交互行:右侧是下拉等控件,整行不点击、不悬浮高亮(继承 GroupRow 后覆盖)
export const GroupRowStatic = styled(GroupRow)`
  cursor: default;

  &:hover {
    background-color: transparent;
  }
`;

// 导航行右侧的 > 箭头(跟随 currentColor 取静音色)
export const Chevron = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

// 高亮行:用主色描边 + 柔和底色,把 AI 建议面板从普通设置项里拎出来。
// flashing:?highlight= 命中时短暂脉冲提示(告知条「设置」按钮跳转来用)。
export const HighlightRow = styled.div<{ flashing?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 6px;
  padding: 16px 18px;
  border-radius: 18px;
  cursor: pointer;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;

  ${({ theme, flashing }: { theme?: ITheme; flashing?: boolean }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primarySoft};
      box-shadow: inset 0 0 0 1px ${p.primary}55, 0 10px 30px -24px ${p.primary};

      &:hover {
        box-shadow: inset 0 0 0 1px ${p.primary}99,
          0 12px 32px -20px ${p.primary};
      }

      ${flashing
        ? css`
            --pulse-c: ${p.primary};
            --pulse-glow: ${p.primary}22;
            animation: ${highlightPulse} 1s ease-in-out 3;
          `
        : ''}
    `;
  }}
`;

export const HighlightBadge = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  vertical-align: middle;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: #fff;
      background: linear-gradient(135deg, ${p.primary}, #16a34a);
    `;
  }}
`;

export const EfficiencySearchCard = styled(HighlightRow)`
  cursor: default;
  display: block;
  padding: 4px;
  background: transparent;
  box-shadow: none;

  &:hover {
    ${({ theme }: { theme?: ITheme }) => {
      const p = getPalette(theme);
      return css`
        box-shadow: none;
      `;
    }}
  }
`;

export const ModeSelector = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(82px, 1fr));
  gap: 3px;
  width: 100%;
  padding: 3px;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

export const SuggestionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;

  @media (max-width: 800px) {
    grid-template-columns: 1fr;
  }
`;

export const SuggestionItem = styled.div<{ disabled?: boolean }>`
  min-height: 52px;
  padding: 10px 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  cursor: pointer;

  ${({ theme, disabled }: { theme?: ITheme; disabled?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.surface};
      border: 1px solid ${p.line};
      opacity: ${disabled ? 0.4 : 1};
      pointer-events: ${disabled ? 'none' : 'auto'};
    `;
  }}
`;

export const ModeButton = styled.button<{ selected?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${selected ? p.primary : p.textSub};
      background: ${selected ? p.surface : 'transparent'};
      box-shadow: ${selected ? `0 1px 3px ${p.line}` : 'none'};

      &:hover {
        color: ${selected ? p.primary : p.text};
      }
    `;
  }}
`;

export const EngineChoices = styled.div`
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
`;

export const EngineChoice = styled.button<{
  selected?: boolean;
  disabled?: boolean;
}>`
  display: flex;
  align-items: center;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: ${({ disabled }) => (disabled ? 'not-allowed' : 'pointer')};
  opacity: ${({ disabled }) => (disabled ? 0.55 : 1)};

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.text};
      background: ${selected ? p.primarySoft : p.bg};
      border: 1px solid ${selected ? `${p.primary}88` : p.line};
    `;
  }}
`;

export const ChoiceMark = styled.span<{ selected?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin-right: 8px;
  border-radius: 3px;

  ${({ theme, selected }: { theme?: ITheme; selected?: boolean }) => {
    const p = getPalette(theme);
    return css`
      color: #fff;
      background: ${selected ? p.primary : 'transparent'};
      border: 1px solid ${selected ? p.primary : p.textMute};
    `;
  }}
`;

export const ChoiceHelp = styled.div`
  width: 100%;
  margin-bottom: 8px;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;
