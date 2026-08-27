import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { DIALOG_BORDER_RADIUS } from '~/renderer/mixins/dialogs';
import { getPalette } from '../../utils/palette';

// ===== 侧边栏 =====

export const Sidebar = styled.div`
  width: 272px;
  min-width: 272px;
  height: 100vh;
  display: flex;
  flex-flow: column;
  padding: 20px 16px;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border-right: 1px solid ${p.line};
    `;
  }}
`;

export const SideHeader = styled.div`
  padding: 0 4px;
`;

export const SideTitle = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const SideSubtitle = styled.p`
  margin: 2px 0 0;
  font-size: 12.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const SearchBox = styled.div`
  margin-top: 16px;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-radius: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textMute};
    `;
  }}
`;

export const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      &::placeholder {
        color: ${p.textMute};
      }
    `;
  }}
`;

export const FolderSection = styled.div`
  margin-top: 22px;
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  display: flex;
  flex-flow: column;

  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.3);
    border-radius: 9999px;
  }
`;

export const SectionLabel = styled.div`
  padding: 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const BottomActions = styled.div`
  margin-top: 12px;
  padding-top: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-top: 1px solid ${getPalette(theme).line};
  `}
`;

export const ActionItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.16s ease, color 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      &:hover {
        background-color: ${p.surface};
        color: ${p.textMain};
      }
    `;
  }}
`;

// ===== 内容区 =====

export const Main = styled.div`
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow: auto;
  padding: 24px 40px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
    `;
  }}

  &::-webkit-scrollbar {
    width: 9px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(149, 163, 184, 0.3);
    border-radius: 9999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
`;

export const MainInner = styled.div`
  max-width: 860px;
  margin: 0 auto;
  position: relative;
`;

export const HeaderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
`;

export const Breadcrumb = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const Crumb = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  ${({
    active,
    dropHover,
    theme,
  }: {
    active?: boolean;
    dropHover?: boolean;
    theme?: ITheme;
  }) => {
    const p = getPalette(theme);
    return css`
      color: ${active ? p.textMain : p.textSub};
      background-color: ${dropHover ? p.primarySoft : 'transparent'};
      box-shadow: ${dropHover ? `inset 0 0 0 1px ${p.primary}` : 'none'};
      &:hover {
        color: ${p.textMain};
      }
    `;
  }}
`;

export const Heading = styled.h2`
  margin: 8px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const HeadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  /* 标题已自带 margin-top,这里让返回按钮跟标题底部对齐 */
  ${Heading} {
    margin: 0;
  }
  margin-top: 8px;
`;

export const BackBtn = styled.button`
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  margin-left: -2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, filter 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textSub};
      &:hover {
        color: ${p.textMain};
        filter: brightness(0.97);
      }
    `;
  }}
`;

export const HeadingSub = styled.p`
  margin: 4px 0 0;
  font-size: 13.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const ActionBtns = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const GhostBtn = styled.button`
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 11px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      color: ${p.textSub};
      &:hover {
        color: ${p.textMain};
      }
      &:disabled {
        opacity: 0.45;
        cursor: default;
      }
    `;
  }}
`;

export const PrimaryBtn = styled.button`
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 11px;
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: filter 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.primary};
      color: #fff;
      &:hover {
        filter: brightness(1.05);
      }
    `;
  }}
`;

// 「仅看标记」切换按钮:激活态用强调色填充。
export const ToggleBtn = styled.button`
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 11px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.16s ease, background-color 0.16s ease,
    border-color 0.16s ease;

  ${({ theme, active }: { theme?: ITheme; active?: boolean }) => {
    const p = getPalette(theme);
    return active
      ? css`
          background-color: ${p.danger};
          border: 1px solid ${p.danger};
          color: #fff;
          &:hover {
            filter: brightness(1.04);
          }
        `
      : css`
          background-color: ${p.surface};
          border: 1px solid ${p.line};
          color: ${p.textSub};
          &:hover {
            color: ${p.textMain};
          }
        `;
  }}
`;

export const ListHeaderRow = styled.div`
  margin-top: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

export const ListLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const CountText = styled.div`
  font-size: 12px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const CardList = styled.div`
  margin-top: 12px;
  display: flex;
  flex-flow: column;
  gap: 10px;
`;

// ===== 对话框（沿用功能，重做外观）=====

export const Dialog = styled.div`
  position: fixed;
  width: 460px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 24px;
  left: 50%;
  top: 50%;
  border-radius: ${DIALOG_BORDER_RADIUS}px;
  z-index: 999;
  transition: 0.2s opacity;
  transform: translate(-50%, -50%);

  ${({ wide }: { wide?: boolean }) =>
    wide
      ? css`
          width: 540px;
        `
      : ''}

  ${({
    visible,
    theme,
  }: {
    visible: boolean;
    theme?: ITheme;
    wide?: boolean;
  }) => {
    const p = getPalette(theme);
    return css`
      opacity: ${visible ? 1 : 0};
      pointer-events: ${visible ? 'inherit' : 'none'};
      background-color: ${p.surface};
      color: ${p.textMain};
      border: 1px solid ${p.line};
      box-shadow: 0 30px 70px -34px rgba(40, 60, 120, 0.45);
    `;
  }}
`;

export const DialogTitle = styled.div`
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 18px;
`;

export const DialogField = styled.label<{ hidden?: boolean }>`
  display: ${({ hidden }) => (hidden ? 'none' : 'block')};
  margin-top: 14px;
`;

export const DialogFieldLabel = styled.div`
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const DialogInput = styled.input`
  width: 100%;
  height: 40px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.bg};
      border-color: ${p.line};

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primarySoft};
      }
    `;
  }}
`;

// ===== 编辑弹窗:所属文件夹选择 =====

export const FolderField = styled.div`
  margin-top: 16px;
`;

export const FolderLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const FolderTrigger = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background-color 0.15s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      &:hover {
        background-color: ${p.surface};
      }
    `;
  }}
`;

export const FolderTriggerText = styled.div`
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

export const FolderTriggerArrow = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  transition: transform 0.15s ease;
  transform: ${({ expanded }: { expanded: boolean }) =>
    expanded ? 'rotate(90deg)' : 'rotate(0deg)'};

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const FolderPanel = styled.div`
  margin-top: 10px;
`;

// ===== 从本机浏览器导入：选择行 =====

export const BrowserRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  transition: background-color 0.16s ease, opacity 0.16s ease;

  svg {
    flex-shrink: 0;
  }

  ${({ disabled, theme }: { disabled?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      opacity: ${disabled ? 0.4 : 1};
      pointer-events: ${disabled ? 'none' : 'auto'};
      &:hover {
        background-color: ${p.surface};
      }
    `;
  }}
`;

export const BrowserBadge = styled.span`
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

export const ImportNote = styled.div`
  margin-top: 14px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({ error, theme }: { error?: boolean; theme?: ITheme }) => css`
    color: ${error ? '#e53935' : getPalette(theme).textSub};
  `}
`;

export const ToolboxSummary = styled.div`
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

export const ToolboxList = styled.div`
  max-height: 280px;
  margin-top: 16px;
  overflow-y: auto;
  border-top: 1px solid
    ${({ theme }: { theme?: ITheme }) => getPalette(theme).line};
`;

export const ToolboxRow = styled.div`
  padding: 10px 0;
  border-bottom: 1px solid
    ${({ theme }: { theme?: ITheme }) => getPalette(theme).line};
`;

export const ToolboxUrl = styled.div`
  overflow: hidden;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMain};
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ToolboxTitles = styled.div`
  margin-top: 4px;
  overflow: hidden;
  color: ${({ theme }: { theme?: ITheme }) => getPalette(theme).textMute};
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const DialogButtons = styled.div`
  float: right;
  display: flex;
  margin-top: 24px;
`;

// ===== 重点标记刻度尺(右侧竖线 + 刻度)=====

export const Ruler = styled.div`
  position: fixed;
  top: 96px;
  bottom: 40px;
  right: 14px;
  width: 14px;
  z-index: 50;
  display: flex;
  justify-content: center;
`;

export const RulerLine = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 2px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).line};
  `}
`;

export const RulerTick = styled.div`
  position: absolute;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.danger};
      box-shadow: 0 0 0 2px ${p.surface};

      &:hover {
        transform: translate(-50%, -50%) scale(1.35);
        box-shadow: 0 0 0 2px ${p.surface}, 0 4px 10px -3px ${p.danger};
      }
    `;
  }}
`;
