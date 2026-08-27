import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';

interface ToneProps {
  bg?: string;
  darkBg?: string;
  color?: string;
  darkColor?: string;
}

export const Root = styled.div`
  position: relative;
  display: flex;
  flex-flow: column;
  flex: 1;
  min-height: 0;
  padding: 4px 20px 20px;
  box-sizing: border-box;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme['dialog.textColor']};
  `};
`;

// 顶部用户区
export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 4px 24px;
  flex-shrink: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    ${theme.dark &&
    css`
      margin: 4px 0 20px;
      padding: 14px 16px;
      border-radius: 22px;
      background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.055) 0%,
        rgba(255, 255, 255, 0.03) 100%
      );
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    `}
  `};
`;

export const HeaderInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

export const Avatar = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #a794ff 0%, #8cb6ff 55%, #5a8cff 100%);
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.12);
  cursor: pointer;
  overflow: hidden;

  ${({ theme }: { theme?: ITheme }) => css`
    border: 1px solid
      ${theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.8)'};
    box-shadow: ${theme.dark
      ? '0 10px 24px rgba(0, 0, 0, 0.28)'
      : '0 6px 24px rgba(20, 32, 72, 0.12)'};
  `};
`;

export const HeaderName = styled.div`
  font-size: 15px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#f3f6ff' : 'inherit'};
  `};
`;

export const HeaderSub = styled.div`
  font-size: 11px;
  font-weight: 700;
  margin-top: 2px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? 'rgba(214, 222, 239, 0.72)' : 'inherit'};
    opacity: ${theme.dark ? 1 : 0.55};
  `};
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const RoundButton = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark ? 'rgba(255,255,255,0.06)' : '#f4f5f7'};
    color: ${theme.dark ? '#eef3ff' : '#5b6472'};
    border: 1px solid
      ${theme.dark ? 'rgba(255,255,255,0.04)' : 'transparent'};
  `};

  &:hover {
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme.dark ? 'rgba(255,255,255,0.1)' : '#e9ebf0'};
    `};
  }
`;

// 顶部四宫格
export const TileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
  flex-shrink: 0;
`;

export const Tile = styled.div`
  display: flex;
  flex-flow: column;
  align-items: center;
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.18s ease,
    box-shadow 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    ${theme.dark &&
    css`
      justify-content: center;
      gap: 8px;
      min-height: 92px;
      padding: 12px 8px 10px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.045);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
    `}
  `};

  &:hover .tile-icon {
    transform: translateY(-2px);
  }

  &:hover {
    ${({ theme }: { theme?: ITheme }) => css`
      ${theme.dark &&
      css`
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.05);
      `}
    `};
  }
`;

export const TileIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  transition: transform 0.18s ease, background-color 0.18s ease;

  ${({ theme, bg, darkBg }: { theme?: ITheme } & ToneProps) => css`
    background-color: ${theme.dark ? darkBg || bg || '#2b3348' : bg || '#eef2ff'};
  `};
`;

export const TileLabel = styled.span`
  font-size: 12px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#dcdcdc' : '#1f2733'};
  `};
`;

// —— 列表区容器（独立滚动区：头部与四宫格固定，仅此区域滚动）——
export const ListPanel = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;

  /* 隐藏滚动条但保留滚动 */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark
      ? 'transparent'
      : 'rgba(255, 255, 255, 0.82)'};
    border-radius: ${theme.dark ? '0' : '18px'};
  `};
`;

export const ListGroup = styled.div`
  padding: 8px 10px;

  ${({ theme }: { theme?: ITheme }) => css`
    ${theme.dark &&
    css`
      padding: 10px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.045);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);

      & + & {
        margin-top: 12px;
      }
    `}
  `};
`;

// 整行菜单项
export const Row = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px;
  border: none;
  background: transparent;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease;
  font: inherit;
  color: inherit;

  &:not(:disabled):hover {
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme.dark
        ? 'rgba(255,255,255,0.06)'
        : '#f5f8ff'};
    `};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export const RowIcon = styled.span`
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  ${({ theme, bg, darkBg, color, darkColor }: { theme?: ITheme } & ToneProps) => css`
    background-color: ${theme.dark ? darkBg || bg || '#202b46' : bg || '#eef2ff'};
    color: ${theme.dark ? darkColor || color || '#8ba5ff' : color || '#3357f6'};
  `};
`;

export const RowLabel = styled.span`
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#e8e8e8' : '#161b2d'};
  `};
`;

export const RowCaret = styled.span`
  flex-shrink: 0;
  display: flex;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? 'rgba(214, 222, 239, 0.52)' : '#a5b0c5'};
  `};
`;

// 分隔线
export const Divider = styled.div`
  height: 1px;
  margin: 0 16px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark ? 'transparent' : '#edf2fa'};
    height: ${theme.dark ? '12px' : '1px'};
    margin: ${theme.dark ? '0' : '0 16px'};
  `};
`;

// 缩放行
export const ZoomBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 16px;
  padding: 10px 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark ? 'rgba(255,255,255,0.04)' : '#f6f8fd'};
    border: ${theme.dark ? '1px solid rgba(255,255,255,0.04)' : 'none'};
  `};
`;

export const ZoomIcon = styled.span`
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4d6bff;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark ? 'rgba(255,255,255,0.08)' : '#fff'};
    box-shadow: ${theme.dark ? 'none' : '0 4px 14px rgba(52,82,255,0.08)'};
  `};
`;

export const ZoomLabel = styled.div`
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#e8e8e8' : '#161b2d'};
  `};
`;

export const ZoomControls = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const ZoomButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6f7d97;
  transition: background-color 0.15s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark ? 'rgba(255,255,255,0.08)' : '#fff'};
    box-shadow: ${theme.dark ? 'none' : '0 3px 10px rgba(20,32,72,0.06)'};
    color: ${theme.dark ? '#e8eefc' : '#6f7d97'};
  `};

  &:hover {
    background-color: ${({ theme }: { theme?: ITheme }) =>
      theme.dark ? 'rgba(255,255,255,0.13)' : '#eef3ff'};
  }
`;

export const ZoomValue = styled.span`
  min-width: 42px;
  text-align: center;
  font-size: 12px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#e8e8e8' : '#161b2d'};
  `};
`;

// 二宫格快捷动作
export const ActionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 10px;
`;

export const ActionTile = styled.button`
  display: flex;
  flex-flow: column;
  align-items: flex-start;
  padding: 12px;
  border: none;
  border-radius: 15px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease, transform 0.15s ease;

  ${({ theme, bg, darkBg }: { theme?: ITheme } & ToneProps) => css`
    background-color: ${theme.dark ? darkBg || bg || '#202d49' : bg || '#f3f7ff'};
  `};

  &:hover {
    ${({ theme, bg, darkBg }: { theme?: ITheme } & ToneProps) => css`
      ${theme.dark
        ? css`
            transform: translateY(-1px);
            background-color: ${darkBg || bg || '#202d49'};
            filter: brightness(1.08);
          `
        : css`
            filter: brightness(0.97);
          `}
    `};
  }
`;

export const ActionIcon = styled.span`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;

  ${({ theme, color, darkColor }: { theme?: ITheme } & ToneProps) => css`
    background: ${theme.dark ? 'rgba(255,255,255,0.08)' : '#fff'};
    color: ${theme.dark ? darkColor || color || '#8fb0ff' : color || '#3b6fe8'};
    box-shadow: ${theme.dark ? 'none' : '0 4px 14px rgba(20, 32, 72, 0.08)'};
  `};
`;

export const ActionLabel = styled.span`
  margin-top: 8px;
  font-size: 12px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#e8e8e8' : '#161b2d'};
  `};
`;

export const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? 'rgba(214,222,239,0.66)' : '#77839a'};
  `};
`;

export const ProfileRowWrap = styled.div`
  position: relative;
`;

export const ProfileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 14px;
  cursor: pointer;
  outline: none;

  &:hover,
  &:focus-visible {
    ${({ theme }: { theme?: ITheme }) => css`
      background-color: ${theme.dark ? 'rgba(255,255,255,0.06)' : '#f5f8ff'};
    `};
  }
`;

export const ProfileMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
`;

export const ProfileName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
`;

export const StatusBadge = styled.span`
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 800;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#9fb3ff' : '#425fe8'};
    background: ${theme.dark ? 'rgba(103,130,255,0.16)' : '#eaf0ff'};
  `};
`;

export const MoreButton = styled.button`
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => css`
    background: ${theme.dark ? 'rgba(255,255,255,0.06)' : '#eef2f8'};
  `};
`;

export const MoreMenu = styled.div`
  position: relative;
  width: calc(100% - 16px);
  margin: -2px 8px 7px;
  padding: 5px;
  box-sizing: border-box;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#eef3ff' : '#20283a'};
    background: ${theme.dark ? '#242938' : '#fff'};
    border: 1px solid ${theme.dark ? 'rgba(255,255,255,0.1)' : '#e2e8f2'};
    box-shadow: ${theme.dark
      ? '0 12px 28px rgba(0,0,0,0.38)'
      : '0 12px 28px rgba(30,42,72,0.16)'};
  `};
`;

export const MoreMenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    ${({ theme }: { theme?: ITheme }) => css`
      background: ${theme.dark ? 'rgba(255,255,255,0.08)' : '#f2f5fa'};
    `};
  }

  &[data-danger='true'] {
    color: #df4b4b;
  }
`;

export const InlineNotice = styled.div`
  margin: 6px 10px 2px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#dce4f7' : '#56647d'};
    background: ${theme.dark ? 'rgba(255,255,255,0.06)' : '#f0f4fa'};
  `};

  &[data-error='true'] {
    user-select: text;
    color: ${({ theme }: { theme?: ITheme }) =>
      theme.dark ? '#ffb4b4' : '#a52d2d'};
    background: ${({ theme }: { theme?: ITheme }) =>
      theme.dark ? 'rgba(196,55,55,0.16)' : '#fff0f0'};
    border: 1px solid
      ${({ theme }: { theme?: ITheme }) =>
        theme.dark ? 'rgba(255,128,128,0.3)' : '#f2c5c5'};
  }
`;

export const ModalOverlay = styled.div`
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(14, 19, 31, 0.44);
  backdrop-filter: blur(3px);
`;

export const Modal = styled.div`
  width: 100%;
  padding: 18px;
  box-sizing: border-box;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#f3f6ff' : '#182033'};
    background: ${theme.dark ? '#222735' : '#fff'};
    border: 1px solid ${theme.dark ? 'rgba(255,255,255,0.1)' : '#e2e8f2'};
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.24);
  `};
`;

export const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  font-size: 15px;
  font-weight: 800;
`;

export const ModalClose = styled.button`
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: inherit;
  background: transparent;
  cursor: pointer;
`;

export const ProfileInput = styled.input`
  width: 100%;
  height: 40px;
  padding: 0 12px;
  box-sizing: border-box;
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#f3f6ff' : '#182033'};
    background: ${theme.dark ? 'rgba(255,255,255,0.06)' : '#f7f9fc'};
    border: 1px solid ${theme.dark ? 'rgba(255,255,255,0.13)' : '#dce3ee'};
  `};

  &:focus {
    border-color: #5874ed;
  }
`;

export const ProfileHint = styled.p`
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#aeb9ce' : '#66738c'};
  `};
`;

export const CloneSection = styled.fieldset`
  min-width: 0;
  margin: 12px 0 0;
  padding: 0;
  border: 0;
`;

export const CloneSectionTitle = styled.legend`
  margin-bottom: 8px;
  padding: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
`;

export const CloneOptionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 10px;
`;

export const CloneOption = styled.label`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  cursor: pointer;
  user-select: none;
`;

export const CloneCheckbox = styled.input`
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #4967e8;
  cursor: pointer;

  &:disabled {
    cursor: wait;
  }
`;

export const CloneOptionLabel = styled.span`
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
`;

export const ModalMessage = styled.div`
  margin-top: 9px;
  min-height: 17px;
  font-size: 11px;
  line-height: 1.5;
  color: #dc4c4c;
`;

export const ConfirmText = styled.div`
  font-size: 13px;
  line-height: 1.65;
  color: inherit;
`;

export const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

export const ModalButton = styled.button`
  min-width: 72px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme.dark ? '#e9eefb' : '#3d4a62'};
    background: ${theme.dark ? 'rgba(255,255,255,0.08)' : '#eef2f7'};
  `};

  &[data-primary='true'] {
    color: #fff;
    background: #4967e8;
  }

  &[data-danger='true'] {
    color: #fff;
    background: #d94b4b;
  }

  &:disabled {
    opacity: 0.55;
    cursor: wait;
  }
`;
