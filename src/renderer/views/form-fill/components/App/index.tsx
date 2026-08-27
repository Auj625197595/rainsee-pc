import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Key } from '@phosphor-icons/react';

import store from '../../store';
import List from '../List';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { StyledApp, Header, HeaderIcon, HeaderTitle, Count } from './style';

export const App = observer(() => (
  <ThemeProvider theme={{ ...store.theme }}>
    <StyledApp
      visible={store.visible}
      onMouseEnter={() => store.notifyEnter()}
      onMouseLeave={() => store.notifyLeave()}
    >
      <UIStyle />
      <Header>
        <HeaderIcon>
          <Key size={15} weight="bold" />
        </HeaderIcon>
        <HeaderTitle>可填充的密码</HeaderTitle>
        <Count>{store.items.length}</Count>
      </Header>
      <List />
    </StyledApp>
  </ThemeProvider>
));
