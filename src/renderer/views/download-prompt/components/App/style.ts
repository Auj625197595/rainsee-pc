import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

const isDark = (theme?: ITheme) =>
  Boolean(theme?.dark || theme?.['dialog.lightForeground']);
const foreground = (theme?: ITheme) =>
  isDark(theme) ? '#f2f4f8' : theme?.['dialog.textColor'] || '#1e2433';
const muted = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(232, 236, 244, 0.62)' : '#727b8e';
const border = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(255, 255, 255, 0.13)' : '#dfe4ed';
const controlBackground = (theme?: ITheme) =>
  isDark(theme) ? 'rgba(255, 255, 255, 0.065)' : 'rgba(255, 255, 255, 0.82)';

export const StyledApp = styled(DialogStyle)`
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid
    ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.1)' : 'rgba(28, 39, 63, 0.08)'};
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  box-shadow: 0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;

  ${({ theme }: { theme?: ITheme }) => css`
    color-scheme: ${isDark(theme) ? 'dark' : 'light'};
    background-color: ${isDark(theme)
      ? 'rgba(31, 33, 39, 0.94)'
      : 'rgba(252, 253, 255, 0.92)'};
    color: ${foreground(theme)};
  `}
`;

export const Header = styled.div`
  min-width: 0;
`;

export const Title = styled.div`
  font-size: 18px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
`;

export const Source = styled.div`
  max-width: 100%;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

export const UrlInput = styled.input`
  width: 100%;
  height: 28px;
  margin-top: 5px;
  padding: 0 8px;
  border: 1px solid ${({ theme }: { theme?: ITheme }) => border(theme)};
  border-radius: 7px;
  outline: none;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  background: ${({ theme }: { theme?: ITheme }) => controlBackground(theme)};

  &:focus {
    border-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#6d9bd3' : '#5b91df'};
    box-shadow: 0 0 0 3px
      ${({ theme }: { theme?: ITheme }) =>
        isDark(theme) ? 'rgba(93, 148, 214, 0.2)' : 'rgba(70, 127, 211, 0.16)'};
  }
`;

export const Field = styled.div`
  display: grid;
  gap: 5px;
  margin-top: 11px;
`;

export const FieldLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
`;

const controlStyle = css`
  width: 100%;
  height: 38px;
  border-radius: 10px;
  outline: none;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: ${({ theme }: { theme?: ITheme }) => controlBackground(theme)};
  border: 1px solid ${({ theme }: { theme?: ITheme }) => border(theme)};
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    background-color 0.15s ease;

  &:focus {
    border-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#6d9bd3' : '#5b91df'};
    box-shadow: 0 0 0 3px
      ${({ theme }: { theme?: ITheme }) =>
        isDark(theme) ? 'rgba(93, 148, 214, 0.2)' : 'rgba(70, 127, 211, 0.16)'};
  }
`;

export const FileInput = styled.input`
  ${controlStyle}
  padding: 0 12px;

  &::selection {
    color: #fff;
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#386da9' : '#397ed0'};
  }
`;

export const SelectControl = styled.div`
  position: relative;

  > svg {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
    pointer-events: none;
  }
`;

export const Select = styled.select`
  ${controlStyle}
  appearance: none;
  padding: 0 38px 0 12px;

  option {
    color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#2b2d33' : '#fff'};
  }
`;

export const PathButton = styled.button`
  ${controlStyle}
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;

  > svg {
    flex-shrink: 0;
    color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  }

  &:hover {
    border-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.22)' : '#aeb8c8'};
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.1)' : '#fff'};
  }
`;

export const PathText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Actions = styled.div`
  min-height: 36px;
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ErrorText = styled.div`
  flex: 1;
  color: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#ff8f89' : '#d93025'};
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
  font-weight: 400;
  color: ${({ theme }: { theme?: ITheme }) => muted(theme)};
  user-select: none;

  input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#5596e2' : '#397ed0'};
  }

  &:has(input:disabled) {
    opacity: 0.45;
  }
`;

const buttonStyle = css`
  min-width: 72px;
  height: 36px;
  padding: 0 15px;
  border-radius: 9px;
  border: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, opacity 0.15s ease;

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

export const CancelButton = styled.button`
  ${buttonStyle}
  min-width: auto;
  color: ${({ theme }: { theme?: ITheme }) => foreground(theme)};
  background: transparent;

  &:hover:not(:disabled) {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 44, 68, 0.06)'};
  }
`;

export const PrimaryButton = styled.button`
  ${buttonStyle}
  color: #fff;
  background: ${({ theme }: { theme?: ITheme }) =>
    isDark(theme) ? '#4387d5' : '#397ed0'};
  box-shadow: 0 6px 16px rgba(57, 126, 208, 0.22);

  &:hover:not(:disabled) {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#5193df' : '#2f70c0'};
  }

  &:active:not(:disabled) {
    background: ${({ theme }: { theme?: ITheme }) =>
      isDark(theme) ? '#3978c2' : '#2864ad'};
  }
`;
