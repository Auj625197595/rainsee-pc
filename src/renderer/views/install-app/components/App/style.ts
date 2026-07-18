import styled, {css} from 'styled-components';

import {ITheme} from '~/interfaces';
import {DialogStyle} from '~/renderer/mixins/dialogs';

// Edge 风格 PWA 安装弹窗:白底圆角,头部图标+名称+发布者+关闭,正文说明+安装选项,
// 底部「安装/取消」按钮。DialogStyle 已提供外边距、圆角、阴影与背景色。
export const StyledApp = styled(DialogStyle)`
  width: 320px;
  padding: 0;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;

  ${({theme}: {theme?: ITheme}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#1a1a1a'};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 12px;
`;

export const AppIconWrap = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 11px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #5b8cff, #3b6fe8);
  box-shadow: 0 2px 6px rgba(59, 111, 232, 0.3);
`;

export const AppIcon = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

export const AppIconFallback = styled.div`
  color: #fff;
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
`;

export const TitleCol = styled.div`
  flex: 1;
  min-width: 0;
`;

export const AppName = styled.div`
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Publisher = styled.div`
  font-size: 12px;
  margin-top: 2px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const CloseBtn = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  font-size: 13px;
  opacity: 0.5;
  flex-shrink: 0;

  &:hover {
    opacity: 0.9;
    background: rgba(0, 0, 0, 0.06);
  }
`;

export const Body = styled.div`
  padding: 4px 16px 12px;
`;

export const BodyText = styled.div`
  font-size: 13px;
  line-height: 1.5;
  opacity: 0.82;
`;

export const OptionsTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  margin: 14px 0 4px;
  opacity: 0.65;
`;

export const OptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  cursor: default;
  padding: 2px 0;
`;

export const CheckBox = styled.div<{checked?: boolean}>`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid currentColor;
  opacity: 0.45;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  ${({checked}) =>
    checked &&
    css`
      opacity: 1;
      background: #3b6fe8;
      border-color: #3b6fe8;
      color: #fff;
      &::after {
        content: '✓';
        font-size: 11px;
        line-height: 1;
      }
    `}
`;

export const OptionLabel = styled.div`
  font-size: 13px;
`;

export const Footer = styled.div`
  display: flex;
  gap: 10px;
  padding: 4px 16px 16px;
  justify-content: flex-end;
`;

export const InstallBtn = styled.button`
  height: 34px;
  padding: 0 22px;
  border-radius: 7px;
  border: none;
  cursor: default;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: #3b6fe8;

  &:hover {
    background: #2f5fd1;
  }

  &:disabled {
    opacity: 0.6;
  }
`;

export const CancelBtn = styled.button`
  height: 34px;
  padding: 0 16px;
  border-radius: 7px;
  cursor: default;
  font-size: 13px;

  ${({theme}: {theme?: ITheme}) => css`
    color: ${theme['dialog.lightForeground'] ? '#fff' : '#1a1a1a'};
    background: ${theme['dialog.lightForeground']
      ? 'rgba(255,255,255,0.1)'
      : '#f0f2f7'};
    border: 1px solid
      ${theme['dialog.lightForeground']
        ? 'rgba(255,255,255,0.15)'
        : 'rgba(0,0,0,0.08)'};
  `}
`;
