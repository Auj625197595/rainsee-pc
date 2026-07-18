import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';
import { BLUE_500 } from '~/renderer/constants';

export const StyledApp = styled(DialogStyle)`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 26px;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark
      ? 'rgba(40, 42, 48, 0.72)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme.dark ? '#fff' : '#000'};
    border: 1px solid
      ${theme.dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.6)'};
    box-shadow:
      0 1px 4px rgba(20, 32, 72, 0.06),
      0 8px 20px rgba(20, 32, 72, 0.12),
      inset 0 1px 0
        ${theme.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.7)'};
  `}
`;

export const ZoomButton = styled.div`
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  cursor: pointer;
  -webkit-app-region: no-drag;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    opacity: 0;
    transition: 0.2s opacity;
  }

  &:hover::before {
    opacity: 1;
  }

  ${({ theme, color, icon }: { theme?: ITheme; color: string; icon: string }) => css`
    &::before {
      background-color: ${theme.dark
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(0, 0, 0, 0.06)'};
    }

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background-color: ${color};
      -webkit-mask: url(${icon}) center / 18px no-repeat;
      mask: url(${icon}) center / 18px no-repeat;
      transition: 0.15s transform;
    }

    &:active::after {
      transform: scale(0.9);
    }
  `}
`;

export const Label = styled.div`
  font-size: 15px;
  font-weight: 600;
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3px;
`;

export const Divider = styled.div`
  width: 1px;
  height: 18px;
  margin: 0 10px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark
      ? 'rgba(255, 255, 255, 0.14)'
      : 'rgba(0, 0, 0, 0.08)'};
  `}
`;

export const ResetButton = styled.div`
  height: 30px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: 0.2s background-color, 0.2s color;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${theme.dark
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(0, 0, 0, 0.05)'};
    color: ${theme.dark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.75)'};

    &:hover {
      background-color: ${BLUE_500};
      color: #fff;
    }
  `}
`;
