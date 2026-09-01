import * as React from 'react';
import styled, { css } from 'styled-components';

import { EASING_FUNCTION } from '~/renderer/constants';
import { ITheme } from '~/interfaces';
import { robotoRegular, robotoMedium } from '~/renderer/mixins';
import { NormalButton } from '../App';
import store from '../../store';
import { getPalette } from '../../utils/palette';
import { getSettingsTranslator } from '../../utils';
import {
  DIALOG_BORDER_RADIUS,
  DIALOG_BOX_SHADOW,
} from '~/renderer/mixins/dialogs';

const onHideClick = () => {
  store.dialogContent = null;
};

export const CloseButton = () => {
  const t = getSettingsTranslator();
  return (
    <NormalButton variant="soft" onClick={onHideClick}>
      {t('cancel')}
    </NormalButton>
  );
};

export const Dialog = styled.div`
  width: 100%;
  max-width: 512px;
  height: fit-content;
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 999;
  /* 显式居中:fixed 元素若不设 top/left,浏览器用"静态位置",在设置页内容流里
     不可靠,会导致整个对话框定位到视口外而不可见。 */
  transform: translate(-50%, -50%);
  border-radius: ${DIALOG_BORDER_RADIUS}px;
  padding-bottom: 8px;
  transition: 0.15s opacity ${EASING_FUNCTION};
  ${robotoRegular()};

  ${({ visible, theme }: { visible: boolean; theme?: ITheme }) => {
    const palette = getPalette(theme);
    return css`
      pointer-events: ${visible ? 'inherit' : 'none'};
      opacity: ${visible ? 1 : 0};
      background-color: ${palette.surface};
      color: ${palette.textMain};
      box-shadow: inset 0 0 0 1px ${palette.line}, ${DIALOG_BOX_SHADOW};
    `;
  }}
`;

export const Title = styled.div`
  padding: 16px 16px 8px 16px;
  font-size: 16px;
  ${robotoMedium()};
`;

export const Content = styled.div`
  padding: 8px 16px 0px 16px;
`;

export const Buttons = styled.div`
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
  padding-right: 8px;

  & > * {
    margin-right: 4px;
  }
`;

export const Bold = styled.span`
  font-size: 14px;
  ${robotoMedium()};
`;
