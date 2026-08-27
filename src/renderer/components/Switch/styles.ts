import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { centerVertical } from '~/renderer/mixins';

interface Props {
  activated: boolean;
  color: string;
  theme: ITheme;
  clickable: boolean;
  dense: boolean;
}

export const StyledSwitch = styled.div`
  border-radius: 32px;
  position: relative;
  overflow: hidden;
  transition: 0.15s background-color;

  &:after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
  }

  ${({ activated, color, theme, clickable, dense }: Props) => css`
    background-color: ${(theme as any).settingsPage
      ? activated
        ? (theme as any).settingsAccent
        : theme['pages.lightForeground']
        ? 'rgba(255, 255, 255, 0.22)'
        : '#D6D6DE'
      : activated
      ? color
      : theme['switch.backgroundColor']};
    cursor: ${clickable ? 'pointer' : 'default'};
    width: ${(theme as any).settingsPage ? 44 : dense ? 32 : 36}px;
    height: ${(theme as any).settingsPage ? 25 : dense ? 16 : 18}px;

    &:hover {
      &:after {
        background-color: ${!activated && theme.dark
          ? 'rgba(0, 0, 0, 0.06)'
          : 'rgba(255, 255, 255, 0.12)'};
      }
    }
  `}
`;

export const Thumb = styled.div`
  border-radius: 100%;
  position: absolute;
  z-index: 3;
  transition: 0.15s left;
  ${centerVertical()};

  ${({
    activated,
    dense,
    theme,
  }: {
    activated: boolean;
    dense: boolean;
    theme: ITheme;
  }) => css`
    width: ${(theme as any).settingsPage ? 19 : dense ? 12 : 14}px;
    height: ${(theme as any).settingsPage ? 19 : dense ? 12 : 14}px;
    left: ${(theme as any).settingsPage
      ? activated
        ? 22
        : 3
      : activated
      ? dense
        ? 18
        : 20
      : 2}px;
    background-color: #fff;
    box-shadow: ${(theme as any).settingsPage
      ? '0 2px 4px rgba(0, 0, 0, 0.15)'
      : 'none'};
  `}
`;
