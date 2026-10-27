import styled, { css, keyframes } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogBaseStyle } from '~/renderer/mixins/dialogs';

const fg = (theme?: ITheme) =>
  theme?.['dialog.lightForeground'] ? '#e8eaed' : '#1f1f1f';
const subtle = (theme?: ITheme) =>
  theme?.['dialog.lightForeground'] ? 'rgba(232,234,237,0.72)' : '#474747';
const divider = (theme?: ITheme) =>
  theme?.['dialog.lightForeground'] ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

const popIn = keyframes`
  0% { opacity: 0; transform: translateY(-6px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
`;

// Chrome 风格:白底圆角卡片,头部图标+标题,正文权限列表,右下角按钮。
// 外边距/阴影/背景色复用 DialogBaseStyle,主进程 bounds 已为其预留 margin。
export const Card = styled(DialogBaseStyle)<{ visible: boolean; width: number }>`
  font-family: 'Segoe UI', -apple-system, 'Microsoft YaHei', sans-serif;
  border-radius: 12px;
  overflow: visible;
  ${({ theme, visible, width }) => css`
    width: ${width}px;
    color: ${fg(theme)};
    opacity: ${visible ? 1 : 0};
    ${visible
      ? css`
          animation: ${popIn} 0.18s cubic-bezier(0.2, 0, 0, 1) both;
        `
      : ''}
  `}
`;

// installed 气泡顶部指向扩展按钮的小三角。
export const Arrow = styled.div<{ right: number }>`
  position: absolute;
  top: -6px;
  width: 12px;
  height: 12px;
  transform: rotate(45deg);
  border-radius: 2px 0 0 0;
  ${({ theme, right }: { theme?: ITheme; right: number }) => css`
    right: ${right - 6}px;
    background: ${theme?.['dialog.backgroundColor']};
    box-shadow: -1px -1px 1px rgba(0, 0, 0, 0.06);
  `}
`;

export const Inner = styled.div`
  position: relative;
  padding: 20px 20px 16px;
  border-radius: 12px;
  overflow: hidden;
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
`;

export const IconBox = styled.div<{ size: number }>`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  ${({ size }) => css`
    width: ${size}px;
    height: ${size}px;
  `}

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

export const IconFallback = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(135deg, #6f9cff, #3b6fe8);
`;

export const TitleCol = styled.div`
  flex: 1;
  min-width: 0;
  padding-top: 2px;
`;

export const Title = styled.div`
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  word-break: break-word;
`;

export const Meta = styled.div`
  margin-top: 3px;
  font-size: 12px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${subtle(theme)};
  `}
`;

export const CloseBtn = styled.button`
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: inherit;
  opacity: 0.6;

  &:hover {
    opacity: 1;
    background: rgba(128, 128, 128, 0.16);
  }

  &:focus-visible {
    outline: 2px solid #0b57d0;
    outline-offset: 1px;
  }
`;

export const Body = styled.div`
  margin-top: 14px;
  font-size: 13px;
  line-height: 19px;
`;

export const Description = styled.div`
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${subtle(theme)};
  `}
`;

export const SectionTitle = styled.div`
  font-weight: 600;
  margin-bottom: 6px;
`;

export const PermissionList = styled.ul`
  margin: 0;
  padding: 0 0 0 18px;
  max-height: 200px;
  overflow-y: auto;

  li {
    margin: 3px 0;
  }
`;

export const Hint = styled.div`
  margin-top: 12px;
  padding-top: 10px;
  font-size: 12px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${subtle(theme)};
    border-top: 1px solid ${divider(theme)};
  `}
`;

// 同名扩展已安装(不同来源)提示框。
export const DuplicateNotice = styled.div`
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme?.['dialog.lightForeground'] ? '#fdd663' : '#7a4f01'};
    background: ${theme?.['dialog.lightForeground']
      ? 'rgba(253, 214, 99, 0.12)'
      : '#fef7e0'};
  `}
`;

export const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
`;

const buttonBase = css`
  height: 32px;
  padding: 0 16px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: default;

  &:focus-visible {
    outline: 2px solid #0b57d0;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.6;
  }
`;

export const PrimaryBtn = styled.button`
  ${buttonBase};
  border: 0;
  color: #fff;
  background: #0b57d0;

  &:hover:not(:disabled) {
    background: #0a4fbd;
  }
`;

export const SecondaryBtn = styled.button`
  ${buttonBase};
  background: transparent;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme?.['dialog.lightForeground'] ? '#a8c7fa' : '#0b57d0'};
    border: 1px solid ${theme?.['dialog.lightForeground'] ? 'rgba(255,255,255,0.3)' : '#c4c7c5'};
  `}

  &:hover:not(:disabled) {
    background: rgba(11, 87, 208, 0.06);
  }
`;

export const TextBtn = styled.button`
  ${buttonBase};
  padding: 0 10px;
  border: 0;
  background: transparent;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${theme?.['dialog.lightForeground'] ? '#a8c7fa' : '#0b57d0'};
  `}

  &:hover {
    background: rgba(11, 87, 208, 0.06);
  }
`;
