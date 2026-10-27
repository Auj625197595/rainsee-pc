import styled, { css } from 'styled-components';
import { DialogStyle } from '~/renderer/mixins/dialogs';
import { ITheme } from '~/interfaces';

export const StyledApp = styled(DialogStyle)`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark
      ? 'rgba(40, 42, 48, 0.82)'
      : 'rgba(255, 255, 255, 0.78)'};
    color: ${theme['dialog.textColor']};
  `};
`;

export const Header = styled.div`
  padding: 14px 16px 8px 16px;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
`;

export const List = styled.div`
  overflow-y: auto;
  max-height: 452px;
  padding: 4px 8px 10px 8px;
`;

export const Empty = styled.div`
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  opacity: 0.5;
`;

export const Item = styled.div<{ dragging?: boolean }>`
  display: flex;
  user-select: none;
  opacity: ${({ dragging }) => (dragging ? 0.5 : 1)};
  align-items: center;
  height: 40px;
  padding: 0 6px 0 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.12s ease;

  &:hover {
    background-color: rgba(127, 127, 127, 0.14);
  }
`;

export const ItemIcon = styled.div`
  width: 20px;
  height: 20px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  flex-shrink: 0;
`;

export const ItemName = styled.div`
  flex: 1;
  margin: 0 10px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const PinButton = styled.div<{ pinned?: boolean }>`
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  transition: background-color 0.12s ease, opacity 0.12s ease;

  ${({ pinned }) => css`
    opacity: ${pinned ? 1 : 0.42};
    color: ${pinned ? '#3b7bff' : 'currentColor'};
  `};

  &:hover {
    background-color: rgba(127, 127, 127, 0.18);
    opacity: 1;
  }
`;

// 「设置」入口(跳转扩展选项页):仅在扩展有 options_page / options_ui 时渲染。
// 默认低透明度,hover 时高亮,与 PinButton 视觉一致。
export const OptionsButton = styled.div`
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  opacity: 0.42;
  transition: background-color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background-color: rgba(127, 127, 127, 0.18);
    opacity: 1;
  }
`;

export const FooterDivider = styled.div`
  height: 1px;
  margin: 2px 12px;
  background-color: rgba(127, 127, 127, 0.18);
  flex-shrink: 0;
`;

export const Footer = styled.div`
  flex-shrink: 0;
  padding: 6px 8px 8px 8px;
`;

export const FooterItem = styled.div`
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.12s ease;

  &:hover {
    background-color: rgba(127, 127, 127, 0.14);
  }

  svg {
    margin-right: 10px;
    flex-shrink: 0;
  }
`;

