import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { ICON_SETTINGS } from '~/renderer/constants/icons';
import {
  StyledApp,
  Header,
  HeaderTitle,
  SettingsButton,
  List,
  Item,
  ItemIcon,
  ItemLabel,
  Check,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

export const App = observer(() => {
  const t = useI18n();
  const engines = store.settings.searchEngines || [];
  const selected = store.settings.searchEngine;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <HeaderTitle>{t('svChooseEngineTitle')}</HeaderTitle>
          <SettingsButton
            title={t('sevEngineSettings')}
            style={{ backgroundImage: `url(${ICON_SETTINGS})` }}
            onClick={() => store.openSettings()}
          />
        </Header>
        <List>
          {engines.map((engine, index) => (
            <Item
              key={engine.keyword || index}
              selected={index === selected}
              onClick={() => store.switchEngine(index)}
            >
              <ItemIcon style={{ backgroundImage: `url(${engine.icon})` }} />
              <ItemLabel>{engine.name}</ItemLabel>
              {index === selected && <Check>✓</Check>}
            </Item>
          ))}
        </List>
      </StyledApp>
    </ThemeProvider>
  );
});
