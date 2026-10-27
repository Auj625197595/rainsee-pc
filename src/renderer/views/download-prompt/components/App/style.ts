import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

type ThemeProps = { theme?: ITheme };

const isDark = (theme?: ITheme) =>
  Boolean(theme?.dark || theme?.['dialog.lightForeground']);
const foreground = (theme?: ITheme) =>
  isDark(theme) ? '#f2f4f8' : theme?.['dialog.textColor'] || '#1e2433';
const muted = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(232, 236, 244, 0.6)' : '#6f788a';
const border = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(255, 255, 255, 0.1)' : 'rgba(30, 42, 66, 0.1)';
const controlBackground = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(255, 255, 255, 0.055)' : 'rgba(244, 246, 250, 0.9)';
const accent = (theme?: ITheme) => (isDark(theme) ? '#5b9cf0' : '#2f74d0');
const focusRing = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(91, 156, 240, 0.24)' : 'rgba(47, 116, 208, 0.16)';

export const StyledApp = styled(DialogStyle)`
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  /* 边缘与扩展列表浮层(extensions-list)保持一致:圆角/描边/毛玻璃/阴影。 */
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  ${({ theme }: ThemeProps) => css`
    color-scheme: ${isDark(theme) ? 'dark' : 'light'};
    background-color: ${isDark(theme)
      ? 'rgba(40, 42, 48, 0.82)'
      : 'rgba(255, 255, 255, 0.78)'};
    color: ${foreground(theme)};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

export const FileBadge = styled.div`
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const HeaderText = styled.div`
  flex: 1;
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 16px;
  font-weight: 650;
  line-height: 1.35;
`;

export const Meta = styled.div`
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: ${({ theme }: ThemeProps) => muted(theme)};
`;

export const Source = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const MetaDot = styled.span`
  flex-shrink: 0;
  opacity: 0.6;
`;

export const Size = styled.span`
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
`;

export const IconButton = styled.button`
  flex-shrink: 0;
  align-self: flex-start;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  color: ${({ theme }: ThemeProps) => muted(theme)};
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: ${({ theme }: ThemeProps) => foreground(theme)};
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 44, 68, 0.06)'};
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px ${({ theme }: ThemeProps) => focusRing(theme)};
  }
`;

export const Divider = styled.div`
  height: 1px;
  margin: 16px -20px 4px;
  background: ${({ theme }: ThemeProps) => border(theme)};
`;

export const Field = styled.div`
  display: grid;
  gap: 6px;
  margin-top: 12px;
`;

export const FieldLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }: ThemeProps) => muted(theme)};
`;

const controlStyle = css`
  width: 100%;
  height: 36px;
  border-radius: 9px;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: ${({ theme }: ThemeProps) => foreground(theme)};
  background: ${({ theme }: ThemeProps) => controlBackground(theme)};
  border: 1px solid ${({ theme }: ThemeProps) => border(theme)};
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    border-color: ${({ theme }: ThemeProps) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.2)' : 'rgba(30, 42, 66, 0.2)'};
  }

  &:focus,
  &:focus-within {
    border-color: ${({ theme }: ThemeProps) => accent(theme)};
    box-shadow: 0 0 0 3px ${({ theme }: ThemeProps) => focusRing(theme)};
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.07)' : '#fff'};
  }
`;

export const FileInput = styled.input`
  ${controlStyle}
  padding: 0 12px;
  font-weight: 500;

  &::selection {
    color: #fff;
    background: ${({ theme }: ThemeProps) => accent(theme)};
  }
`;

export const PathControl = styled.div`
  ${controlStyle}
  padding: 0 4px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;

  > svg {
    flex-shrink: 0;
    color: ${({ theme }: ThemeProps) => muted(theme)};
  }
`;

export const PathText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ChangeButton = styled.button`
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: ${({ theme }: ThemeProps) => accent(theme)};
  background: ${({ theme }: ThemeProps) =>
    isDark(theme) ? 'rgba(91, 156, 240, 0.14)' : 'rgba(47, 116, 208, 0.09)'};
  transition: background-color 0.15s ease;

  &:hover {
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? 'rgba(91, 156, 240, 0.22)' : 'rgba(47, 116, 208, 0.15)'};
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }: ThemeProps) => accent(theme)};
  }
`;

export const SelectControl = styled.div`
  position: relative;

  > svg {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    color: ${({ theme }: ThemeProps) => muted(theme)};
    pointer-events: none;
  }
`;

export const Select = styled.select`
  ${controlStyle}
  appearance: none;
  padding: 0 36px 0 12px;
  cursor: pointer;

  option {
    color: ${({ theme }: ThemeProps) => foreground(theme)};
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? '#2b2d33' : '#fff'};
  }
`;

export const Actions = styled.div`
  min-height: 36px;
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ErrorText = styled.div`
  flex: 1;
  min-width: 0;
  color: ${({ theme }: ThemeProps) => (isDark(theme) ? '#ff8f89' : '#d93025')};
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const OpenOption = styled.label`
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: ${({ theme }: ThemeProps) => muted(theme)};
  user-select: none;
  cursor: pointer;

  input {
    width: 15px;
    height: 15px;
    margin: 0;
    cursor: pointer;
    accent-color: ${({ theme }: ThemeProps) => accent(theme)};
  }

  &:has(input:disabled) {
    opacity: 0.45;
    cursor: default;
  }
`;

const buttonStyle = css`
  min-width: 76px;
  height: 34px;
  padding: 0 16px;
  border-radius: 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease,
    opacity 0.15s ease;

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px ${({ theme }: ThemeProps) => focusRing(theme)};
  }
`;

export const CancelButton = styled.button`
  ${buttonStyle}
  color: ${({ theme }: ThemeProps) => foreground(theme)};
  background: transparent;
  border: 1px solid ${({ theme }: ThemeProps) => border(theme)};

  &:hover:not(:disabled) {
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.06)' : 'rgba(31, 44, 68, 0.04)'};
  }
`;

export const PrimaryButton = styled.button`
  ${buttonStyle}
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #fff;
  background: ${({ theme }: ThemeProps) => accent(theme)};

  &:hover:not(:disabled) {
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? '#6aa7f3' : '#2766bb'};
  }

  &:active:not(:disabled) {
    background: ${({ theme }: ThemeProps) =>
      isDark(theme) ? '#4d8de0' : '#2259a5'};
  }
`;

export const badgeColors = (
  colors: { fg: string; bg: string; darkFg: string; darkBg: string },
  theme?: ITheme,
) =>
  isDark(theme)
    ? { color: colors.darkFg, background: colors.darkBg }
    : { color: colors.fg, background: colors.bg };
