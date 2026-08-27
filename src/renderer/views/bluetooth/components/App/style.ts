import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  position: relative;
  padding: 20px 20px 24px;
  border-radius: 24px;
  font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI',
    sans-serif;
  overflow: hidden;
  isolation: isolate;

  background-color: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 1px 4px rgba(20, 32, 72, 0.05),
    0 10px 26px rgba(20, 32, 72, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.74);

  ${({ theme }: { theme?: ITheme }) =>
    theme?.dark
      ? css`
          background-color: rgba(40, 44, 52, 0.76);
          border-color: rgba(255, 255, 255, 0.12);
          color: #f3f5f9;
        `
      : ''}
`;

export const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
`;

export const IconBadge = styled.div`
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  margin-top: 2px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3d6cff;
  background-color: rgba(92, 139, 230, 0.14);
  border: 1px solid rgba(92, 139, 230, 0.24);
`;

export const HeaderMain = styled.div`
  min-width: 0;
  flex: 1;
`;

export const Eyebrow = styled.div`
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: #86a0c5;
`;

export const Title = styled.div`
  margin-top: 8px;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.4px;
  color: #161b2d;
  line-height: 1.15;
`;

export const Domain = styled.div`
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #75809a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const DeviceList = styled.div`
  margin-top: 16px;
  height: 188px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
`;

export const DeviceItem = styled.button<{ selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: #5b7bd6;
  transition: background-color 0.14s ease, border-color 0.14s ease,
    transform 0.14s ease;

  ${({ selected }) =>
    selected
      ? css`
          background-color: rgba(92, 139, 230, 0.16);
          border-color: rgba(92, 139, 230, 0.5);
        `
      : css`
          background-color: rgba(255, 255, 255, 0.66);
          border-color: rgba(228, 235, 246, 0.95);
        `}

  &:hover {
    transform: translateY(-1px);
  }
`;

export const DeviceMain = styled.div`
  min-width: 0;
  flex: 1;
`;

export const DeviceName = styled.div`
  font-size: 13px;
  font-weight: 800;
  color: #1d2437;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const DeviceId = styled.div`
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: #8d99b3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Empty = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
  color: #75809a;
`;

export const Footer = styled.div`
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;

export const Buttons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ActionButton = styled.button<{
  variant?: 'primary' | 'secondary';
}>`
  min-width: 92px;
  height: 40px;
  border: none;
  border-radius: 14px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease,
    background-color 0.16s ease;

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    filter: brightness(0.98);
  }

  &:disabled {
    cursor: default;
    transform: none;
    filter: grayscale(0.4) opacity(0.6);
    box-shadow: none;
  }

  ${({ variant }) =>
    variant === 'primary'
      ? css`
          color: #ffffff;
          background: linear-gradient(135deg, #4b7cff 0%, #2f63f5 100%);
          box-shadow: 0 12px 24px rgba(55, 103, 245, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        `
      : css`
          color: #33415c;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(216, 225, 240, 0.95);
          box-shadow: 0 8px 18px rgba(20, 32, 72, 0.07),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        `}
`;
