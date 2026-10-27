import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  padding: 12px 14px 14px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 26px;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme: ITheme }) => css`
    box-shadow: ${theme['dialog.lightForeground']
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme['dialog.lightForeground']
      ? 'rgba(0, 0, 0, 0.92)'
      : 'rgba(255, 255, 255, 0.72)'};
    border-color: ${theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(255, 255, 255, 0.55)'};
    color: ${theme['dialog.textColor']};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 2px 4px 14px;
`;

export const SiteName = styled.div`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 17px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }

  &:not(:disabled):hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(60, 64, 67, 0.1)'};
  }
`;

export const Section = styled.div``;

export const RowButton = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:not(:disabled):hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(60, 64, 67, 0.08)'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export const RowIcon = styled.div<{ $tone: 'secure' | 'muted' }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: ${({ $tone, theme }: { $tone: 'secure' | 'muted'; theme: ITheme }) =>
    $tone === 'secure'
      ? theme['dialog.lightForeground']
        ? '#91c9ff'
        : '#1967d2'
      : theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.76)'
      : '#5f6368'};
`;

export const RowMain = styled.div`
  min-width: 0;
  flex: 1;
`;

export const RowTitle = styled.div`
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RowDetail = styled.div`
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.7;
`;

export const PageContent = styled.div`
  max-height: 354px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(95, 99, 104, 0.28)'};
  }
`;

export const PermissionList = styled.div`
  max-height: 150px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(95, 99, 104, 0.28)'};
  }
`;

export const PermissionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 4px 12px;
`;

export const PermissionSelect = styled.select`
  max-width: 106px;
  height: 30px;
  padding: 0 26px 0 8px;
  border: 1px solid
    ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(60, 64, 67, 0.22)'};
  border-radius: 6px;
  outline: none;
  background-color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(255, 255, 255, 0.64)'};
  color: inherit;
  color-scheme: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground'] ? 'dark' : 'light'};
  font: inherit;
  font-size: 12px;

  option {
    color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground'] ? '#f1f3f4' : '#202124'};
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground'] ? '#24272d' : '#ffffff'};
  }

  &:focus-visible {
    border-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground'] ? '#91c9ff' : '#1967d2'};
  }
`;

export const Divider = styled.div`
  height: 1px;
  margin: 5px 12px;
  background-color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.14)'
      : 'rgba(60, 64, 67, 0.16)'};
`;

export const Summary = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
`;

export const SummaryTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
`;

export const SummaryText = styled.div`
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.55;
  opacity: 0.72;
`;

export const ActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  flex-shrink: 0;
  border: 1px solid
    ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(60, 64, 67, 0.2)'};
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;

  &:not(:disabled):hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.1)'
        : 'rgba(60, 64, 67, 0.08)'};
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

export const CookieList = styled.div`
  max-height: 274px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.2)'
        : 'rgba(95, 99, 104, 0.28)'};
  }
`;

export const CookieItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 68px;
  padding: 8px 12px;
  border-radius: 6px;

  &:hover {
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(60, 64, 67, 0.06)'};
  }
`;

export const CookieValue = styled.div`
  margin-top: 3px;
  overflow: hidden;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 11px;
  opacity: 0.78;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const CookieMeta = styled.div`
  margin-top: 3px;
  overflow: hidden;
  font-size: 11px;
  opacity: 0.58;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const DetailList = styled.div`
  padding: 4px 12px 12px;
`;

export const DetailRow = styled.div`
  padding: 10px 0;
  border-bottom: 1px solid
    ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(60, 64, 67, 0.12)'};

  &:last-child {
    border-bottom: none;
  }
`;

export const DetailLabel = styled.div`
  font-size: 11px;
  opacity: 0.62;
`;

export const DetailValue = styled.div<{ $wrap?: boolean }>`
  margin-top: 4px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: ${({ $wrap }) => ($wrap ? 'normal' : 'nowrap')};
  word-break: ${({ $wrap }) => ($wrap ? 'break-all' : 'normal')};
`;

export const EmptyState = styled.div`
  padding: 34px 16px;
  text-align: center;
  font-size: 13px;
  opacity: 0.62;
`;

const inputBorder = ({ theme }: { theme: ITheme }) =>
  theme['dialog.lightForeground']
    ? 'rgba(255, 255, 255, 0.2)'
    : 'rgba(60, 64, 67, 0.22)';

const accent = ({ theme }: { theme: ITheme }) =>
  theme['dialog.lightForeground'] ? '#91c9ff' : '#1967d2';

export const CookieToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 12px 8px;
`;

export const ExportPanel = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 10px 12px;
  border: 1px solid ${inputBorder};
  border-radius: 8px;
  background-color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(255, 255, 255, 0.6)'};
`;

export const ExportLabel = styled.div`
  width: 100%;
  font-size: 13px;
  font-weight: 600;
`;

export const ExportHint = styled.div`
  width: 100%;
  font-size: 12px;
  color: ${accent};
`;

export const CookieMainButton = styled.button`
  min-width: 0;
  flex: 1;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
`;

export const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 12px 12px;
`;

export const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;

  > span {
    opacity: 0.72;
  }
`;

export const FieldRow = styled.div`
  display: flex;
  gap: 10px;

  > * {
    min-width: 0;
    flex: 1;
  }
`;

const inputCss = css`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid ${inputBorder};
  border-radius: 6px;
  outline: none;
  background-color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(255, 255, 255, 0.72)'};
  color: inherit;
  color-scheme: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground'] ? 'dark' : 'light'};
  font: inherit;
  font-size: 13px;

  &:focus-visible {
    border-color: ${accent};
  }

  &:disabled {
    opacity: 0.5;
  }

  option {
    color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground'] ? '#f1f3f4' : '#202124'};
    background-color: ${({ theme }: { theme: ITheme }) =>
      theme['dialog.lightForeground'] ? '#24272d' : '#ffffff'};
  }
`;

export const TextInput = styled.input`
  ${inputCss}
  height: 32px;
`;

export const TextArea = styled.textarea`
  ${inputCss}
  min-height: 64px;
  resize: vertical;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 12px;
  word-break: break-all;
`;

export const Select = styled.select`
  ${inputCss}
  height: 32px;
`;

export const FieldHint = styled.span`
  font-size: 11px;
  opacity: 0.58 !important;
`;

export const CheckRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 13px;

  label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  input {
    margin: 0;
    accent-color: ${accent};
  }
`;

export const FormError = styled.div`
  font-size: 12px;
  color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground'] ? '#f28b82' : '#d93025'};
`;

export const FormActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;

  > :first-child {
    margin-right: auto;
  }
`;

export const PrimaryButton = styled(ActionButton)`
  border-color: transparent;
  background-color: ${accent};
  color: ${({ theme }: { theme: ITheme }) =>
    theme['dialog.lightForeground'] ? '#202124' : '#ffffff'};

  &:not(:disabled):hover {
    background-color: ${accent};
    filter: brightness(1.08);
  }
`;
