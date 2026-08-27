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

export const StyledApp = styled(DialogStyle).attrs({ as: 'form' })`
  padding: 20px;
  border: 1px solid
    ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.1)' : 'rgba(28, 39, 63, 0.08)'};
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  box-shadow: 0 2px 5px rgba(20, 32, 72, 0.08),
    0 8px 18px rgba(20, 32, 72, 0.12);

  ${({ theme }: { theme?: ITheme }) => css`
    color-scheme: ${isDark(theme) ? 'dark' : 'light'};
    color: ${foreground(theme)};
    background: ${isDark(theme)
      ? 'rgba(31, 33, 39, 0.97)'
      : 'rgba(252, 253, 255, 0.98)'};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const HeaderIcon = styled.div`
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 11px;
  color: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#9bc5f4' : '#2f70bf'};
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(85, 150, 226, 0.16)' : '#eaf3ff'};
`;

export const HeaderText = styled.div`
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 17px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: 0;
`;

export const Subtitle = styled.div`
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.45;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

export const Site = styled.div`
  min-width: 0;
  height: 30px;
  margin: 14px 0 16px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 7px;
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

export const SavedCredential = styled.div`
  display: grid;
  gap: 5px;
  margin-bottom: 12px;
`;

export const SavedCredentialLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

export const CredentialSelect = styled.select`
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid ${({ theme }: { theme?: ITheme }) => border(theme)};
  border-radius: 8px;
  outline: none;
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.055)' : '#fff'};
  font: inherit;
  font-size: 13px;

  &:focus {
    border-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#6d9bd3' : '#4d85ce'};
    box-shadow: 0 0 0 3px
      ${({ theme }: { theme?: ITheme }) =>
        isDark(theme) ? 'rgba(93, 148, 214, 0.2)' : 'rgba(70, 127, 211, 0.15)'};
  }

  option {
    color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#2b2d33' : '#fff'};
  }
`;

export const Field = styled.div`
  display: grid;
  gap: 5px;

  & + & {
    margin-top: 12px;
  }
`;

export const FieldLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

export const FieldControl = styled.div<{ $invalid?: boolean }>`
  height: 42px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid
    ${({ theme, $invalid }: { theme?: ITheme; $invalid?: boolean }) =>
      $invalid ? '#d84a4a' : border(theme)};
  border-radius: 9px;
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? 'rgba(255, 255, 255, 0.055)' : '#fff'};
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    background-color 0.15s ease;

  > svg {
    flex-shrink: 0;
    color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  }

  &:focus-within {
    border-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#6d9bd3' : '#4d85ce'};
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : '#fff'};
    box-shadow: 0 0 0 3px
      ${({ theme }: { theme?: ITheme }) =>
        isDark(theme) ? 'rgba(93, 148, 214, 0.2)' : 'rgba(70, 127, 211, 0.15)'};
  }
`;

export const Input = styled.input`
  min-width: 0;
  height: 100%;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 0;
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: transparent;
  font: inherit;
  font-size: 13px;

  &::placeholder {
    color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
    opacity: 0.78;
  }
`;

export const VisibilityButton = styled.button`
  width: 28px;
  height: 28px;
  margin-right: -4px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  background: transparent;
  cursor: pointer;

  &:hover {
    color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.1)' : '#edf1f6'};
  }
`;

export const Actions = styled.div`
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const buttonStyle = css`
  min-width: 72px;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
`;

export const CancelButton = styled.button`
  ${buttonStyle}
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: transparent;

  &:hover {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 44, 68, 0.06)'};
  }
`;

export const PrimaryButton = styled.button`
  ${buttonStyle}
  color: #fff;
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#4387d5' : '#397ed0'};
  box-shadow: 0 6px 16px rgba(57, 126, 208, 0.2);

  &:hover {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#5193df' : '#2f70c0'};
  }

  &:active {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#3978c2' : '#2864ad'};
  }
`;
