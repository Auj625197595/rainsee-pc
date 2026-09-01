import styled, { css } from 'styled-components';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 28px 28px 20px;
  border-radius: 8px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  color: #202124;
  background: #fff;
  border: 1px solid #dadce0;
  box-shadow: 0 4px 18px rgba(60, 64, 67, 0.22);
`;

export const Header = styled.div` margin-bottom: 20px; `;
export const Title = styled.div`
  font-size: 18px;
  line-height: 1.35;
  font-weight: 400;
  color: #202124;
`;
export const DeviceList = styled.div`
  height: 278px;
  overflow-y: auto;
  border: 1px solid #dadce0;
  border-radius: 4px;
  background: #fff;
`;
export const DeviceItem = styled.button<{ selected?: boolean }>`
  width: 100%;
  min-height: 64px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid #f1f3f4;
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: ${({ selected }) => (selected ? '#e8f0fe' : '#fff')};
  &:hover { background: ${({ selected }) => (selected ? '#d2e3fc' : '#f8fafd')}; }
  &:last-child { border-bottom: 0; }
`;
export const DeviceIcon = styled.span`
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5f6368;
`;
export const DeviceMain = styled.span` min-width: 0; flex: 1; `;
export const DeviceName = styled.span`
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: #202124;
`;
export const DeviceMeta = styled.span`
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: #5f6368;
`;
export const Empty = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5f6368;
  font-size: 14px;
`;
export const Footer = styled.div`
  display: flex;
  align-items: center;
  margin-top: 20px;
`;
export const HelpButton = styled.button`
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5f6368;
  background: transparent;
  cursor: pointer;
  &:hover { background: #f1f3f4; }
`;
export const Buttons = styled.div` margin-left: auto; display: flex; gap: 10px; `;
export const ActionButton = styled.button<{ cancel?: boolean; disabled?: boolean }>`
  min-width: 82px;
  height: 36px;
  padding: 0 16px;
  border-radius: 4px;
  border: 1px solid ${({ cancel, disabled }) =>
    cancel ? '#dadce0' : !disabled ? '#1a73e8' : '#dadce0'};
  background: ${({ cancel, disabled }) =>
    cancel ? '#fff' : !disabled ? '#1a73e8' : '#f1f3f4'};
  color: ${({ cancel, disabled }) =>
    cancel ? '#1a73e8' : !disabled ? '#fff' : '#80868b'};
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: ${({ cancel, disabled }) => (cancel || !disabled ? 'pointer' : 'default')};
  ${({ cancel, disabled }) => cancel
    ? css` &:hover { background: #f8fafd; } `
    : !disabled && css` &:hover { background: #1765cc; } `}
  &:disabled { opacity: 1; }
`;
