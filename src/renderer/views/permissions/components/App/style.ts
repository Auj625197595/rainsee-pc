import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  position: relative;
  padding: 20px 20px 28px;
  border-radius: 24px;
  font-family: 'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
  isolation: isolate;

  background-color: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 10px 26px rgba(20, 32, 72, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.74);

  &::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 150px;
    background: linear-gradient(
      180deg,
      rgba(70, 135, 255, 0.08) 0%,
      rgba(70, 135, 255, 0.02) 42%,
      rgba(255, 255, 255, 0) 100%
    );
    pointer-events: none;
    z-index: -1;
  }

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
  font-size: 26px;
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

export const HeaderIconButton = styled.button`
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 14px;
  background-color: #ffffff;
  box-shadow: 0 6px 24px rgba(20, 32, 72, 0.08);
  border: 1px solid #e7edf8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4c5e79;
  cursor: pointer;
  transition: color 0.18s ease, transform 0.18s ease;

  &:hover {
    color: #161b2d;
    transform: translateY(-1px);
  }
`;

export const Permissions = styled.div`
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const Permission = styled.div`
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 0 14px;
  border-radius: 16px;
  font-size: 14px;
  font-weight: 800;
  color: #1d2437;
  background-color: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(228, 235, 246, 0.95);
  box-shadow: 0 6px 18px rgba(20, 32, 72, 0.05);
`;

export const Footer = styled.div`
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const RememberLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
  font-size: 13px;
  font-weight: 700;
  color: #53627d;
  cursor: pointer;
  user-select: none;
`;

export const RememberBox = styled.span<{ checked: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.16s ease;

  ${({ checked }) =>
    checked
      ? css`
          color: #ffffff;
          background-color: #3d6cff;
          box-shadow: 0 8px 18px rgba(61, 108, 255, 0.26);
        `
      : css`
          color: transparent;
          background-color: rgba(255, 255, 255, 0.82);
          border: 1px solid #d7e0ef;
        `}
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
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    filter 0.16s ease,
    background-color 0.16s ease;

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    filter: brightness(0.98);
  }

  ${({ variant }) =>
    variant === 'primary'
      ? css`
          color: #ffffff;
          background: linear-gradient(135deg, #4b7cff 0%, #2f63f5 100%);
          box-shadow:
            0 12px 24px rgba(55, 103, 245, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        `
      : css`
          color: #33415c;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(216, 225, 240, 0.95);
          box-shadow:
            0 8px 18px rgba(20, 32, 72, 0.07),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        `}
`;
