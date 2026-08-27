import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

const isDark = (theme?: ITheme) =>
  Boolean(theme?.dark || theme?.['dialog.lightForeground']);

const foreground = (theme?: ITheme) =>
  isDark(theme) ? '#f2f4f8' : theme?.['dialog.textColor'] || '#1d2433';

const muted = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(236, 240, 247, 0.62)' : '#6e7789';

const border = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(255, 255, 255, 0.14)' : '#dce2eb';

export const StyledApp = styled(DialogStyle)`
  margin: 3px 10px 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 26px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme }) => css`
    color-scheme: ${isDark(theme) ? 'dark' : 'light'};
    color: ${foreground(theme)};
    background: ${isDark(theme)
      ? 'rgba(15, 18, 24, 0.9)'
      : 'rgba(255, 255, 255, 0.76)'};
    box-shadow: ${isDark(theme)
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      : '0 1px 4px rgba(20, 32, 72, 0.05), 0 4px 12px rgba(20, 32, 72, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7)'};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 0 2px;
`;

export const HeaderIcon = styled.div`
  width: 30px;
  height: 30px;
  margin-right: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 10px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.12);
`;

export const HeaderText = styled.div`
  min-width: 0;
`;

export const Title = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: 0;
`;

export const Subtitle = styled.div`
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.35;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

export const Site = styled.div`
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 8px;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.06)' : '#f2f5f9'};

  > svg {
    flex-shrink: 0;
  }
`;

export const SiteAddress = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
`;

export const Container = styled.div`
  min-height: 0;
  padding: 0;
`;

export const FieldsSection = styled.div<{ $visible: boolean }>`
  display: ${({ $visible }) => ($visible ? 'block' : 'none')};

  & .textfield {
    width: 100% !important;
    margin-top: 6px;
    border-radius: 8px;
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme)
        ? 'rgba(255, 255, 255, 0.055)'
        : 'rgba(242, 245, 249, 0.88)'};
  }

  & .textfield:first-child {
    margin-top: 0;
  }

  & .textfield input {
    height: 46px;
    font-size: 14px;
  }
`;

export const Buttons = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid ${({ theme }: { theme?: ITheme }) => border(theme)};
`;

const buttonStyle = css`
  min-width: 72px;
  height: 32px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 9px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;

  &:active {
    transform: scale(0.98);
  }
`;

export const SecondaryButton = styled.button`
  ${buttonStyle}
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 44, 68, 0.07)'};

  &:hover {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.14)' : 'rgba(31, 44, 68, 0.12)'};
  }
`;

export const PrimaryButton = styled.button`
  ${buttonStyle}
  color: #fff;
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#4387d5' : '#397ed0'};
  box-shadow: 0 5px 12px rgba(57, 126, 208, 0.2);

  &:hover {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#5193df' : '#2f70c0'};
  }
`;

export const ManageButton = styled(SecondaryButton)`
  margin-right: auto;
  color: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#9bc5f4' : '#397ed0'};
  background: transparent;

  &:hover {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(57, 126, 208, 0.08)'};
  }
`;
