import styled, { css } from 'styled-components';

import { robotoRegular, centerIcon } from '~/renderer/mixins';
import { transparency, ICON_CLOSE } from '~/renderer/constants';
import { ITheme } from '~/interfaces';

export const StyledList = styled.div<{ $visible: boolean }>`
  display: ${({ $visible }) => ($visible ? 'block' : 'none')};
  max-height: 152px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(100, 110, 130, 0.34);
  }
`;

export const StyledItem = styled.div`
  display: flex;
  min-height: 36px;
  padding: 0 8px;
  align-items: center;
  border-radius: 9px;
  transition: background-color 0.15s ease;

  &:hover {
    ${({ theme }: { theme?: ITheme }) => css`
      background: ${theme?.dark || theme?.['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(71, 114, 232, 0.08)'};
    `}
  }
`;

export const Username = styled.div`
  font-size: 13px;
  color: ${({ theme }: { theme?: ITheme }) =>
    theme?.dark || theme?.['dialog.lightForeground']
      ? `rgba(236, 240, 247, ${transparency.text.medium})`
      : `rgba(0, 0, 0, ${transparency.text.medium})`};
  flex: 2;
  ${robotoRegular()};
`;

export const Password = styled(Username)`
  flex: 1;
`;

export const DeleteIcon = styled.div`
  width: 16px;
  height: 16px;
  background-image: url(${ICON_CLOSE});
  opacity: ${transparency.icons.inactive};
  border-radius: 5px;
  cursor: pointer;
  ${centerIcon('contain')};

  &:hover {
    opacity: 1;
    background-color: rgba(220, 70, 70, 0.1);
  }
`;
