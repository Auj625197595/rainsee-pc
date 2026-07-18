import styled, { css } from 'styled-components';
import { DialogStyle } from '~/renderer/mixins/dialogs';
import { ITheme } from '~/interfaces';

export const StyledApp = styled(DialogStyle)`
  /* DialogBaseStyle 的外边距合计 19px(上 3 + 下 16)，
     显式绑定高度让内部 Root 的滚动确定可用，避免窗口变小时被裁切。 */
  height: calc(100vh - 19px);
  max-height: calc(100vh - 19px);
  display: flex;
  flex-flow: column;
  overflow: hidden;
  border-radius: 26px;
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);

  ${({ theme }: { theme?: ITheme }) => css`
    border: 1px solid
      ${theme.dark
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(255, 255, 255, 0.55)'};
    box-shadow: ${theme.dark
      ? `inset 0 1px 0 rgba(255, 255, 255, 0.04)`
      : `0 1px 4px rgba(20, 32, 72, 0.05),
         0 4px 12px rgba(20, 32, 72, 0.06),
         inset 0 1px 0 rgba(255, 255, 255, 0.7)`};
    background-color: ${theme.dark
      ? 'rgba(15, 18, 24, 0.88)'
      : 'rgba(255, 255, 255, 0.72)'};
    color: ${theme['dialog.textColor']};
  `};
`;

export const Title = styled.div`
  font-size: 16px;
`;

export const Subtitle = styled.div`
  font-size: 13px;
  opacity: 0.54;
  margin-top: 8px;
`;

export const Buttons = styled.div`
  display: flex;
  margin-top: 16px;
  float: right;
`;
