import styled, { css } from 'styled-components';

import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  height: calc(100% - 19px);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);

  ${({ theme }: { theme?: ITheme; visible: boolean }) => css`
    box-shadow: ${theme.dark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme.dark
      ? 'rgba(15, 18, 24, 0.88)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme['dialog.textColor']};
  `}
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  min-height: 28px;
  padding: 0 2px;
  flex-shrink: 0;
`;

export const HeaderIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 8px;
  border-radius: 8px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.12);
`;

export const HeaderTitle = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0;
`;

export const Count = styled.div`
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.1);
  font-size: 11px;
  font-weight: 700;
  box-sizing: border-box;
`;
