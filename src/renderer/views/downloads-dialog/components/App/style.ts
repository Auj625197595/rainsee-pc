import styled, { css } from 'styled-components';
import { ITheme } from '~/interfaces';
import { DialogStyle } from '~/renderer/mixins/dialogs';

export const StyledApp = styled(DialogStyle)`
  display: flex;
  flex-flow: column;
  /* #app 是 height:100vh 的弹性列容器,弹窗首次打开时 BrowserView 高度为 0,
     默认 flex-shrink:1 会把本元素压成一条线,导致 offsetHeight 测量值≈0,
     高度上报后窗口永远撑不开。禁止收缩,保证测量到真实内容高度。 */
  flex-shrink: 0;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow:
    0 1px 4px rgba(20, 32, 72, 0.05),
    0 4px 12px rgba(20, 32, 72, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);

  ${({ theme, menuOpen }: { theme?: ITheme; visible: boolean; menuOpen?: boolean }) => css`
    overflow: ${menuOpen ? 'visible' : 'hidden'};
    background-color: ${theme.dark
      ? 'rgba(40, 42, 48, 0.82)'
      : 'rgba(248, 251, 255, 0.96)'};
    color: ${theme['dialog.textColor']};
  `};
`;
