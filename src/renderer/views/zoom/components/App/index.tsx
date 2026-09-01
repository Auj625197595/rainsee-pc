import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  StyledApp,
  ZoomButton,
  Label,
  Divider,
  ResetButton,
} from './style';
import store from '../../store';
import { ipcRenderer } from 'electron';
import { UIStyle } from '~/renderer/mixins/default-styles';

import { ICON_MAGNIFY_PLUS, ICON_MAGNIFY_MINUS } from '~/renderer/constants/icons';
import { BLUE_500, ORANGE_500 } from '~/renderer/constants';
import { useI18n } from '~/renderer/components/I18n';

const onPlus = () => {
  ipcRenderer.send('change-zoom', 'in');
};

const onMinus = () => {
  ipcRenderer.send('change-zoom', 'out');
};

const onReset = () => {
  ipcRenderer.send('reset-zoom');
};

export const App = observer(() => {
  const t = useI18n();
  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['dialog.lightForeground'] }}
    >
      <StyledApp
        onMouseEnter={() => store.stopHideTimer()}
        onMouseLeave={() => store.resetHideTimer()}
      >
        <UIStyle />
        <ZoomButton
          icon={ICON_MAGNIFY_MINUS}
          color={ORANGE_500}
          onClick={onMinus}
        />
        <Label>{(store.zoomFactor * 100).toFixed(0)}%</Label>
        <ZoomButton icon={ICON_MAGNIFY_PLUS} color={BLUE_500} onClick={onPlus} />
        <Divider />
        <ResetButton onClick={onReset}>{t('zoomReset')}</ResetButton>
      </StyledApp>
    </ThemeProvider>
  );
});
