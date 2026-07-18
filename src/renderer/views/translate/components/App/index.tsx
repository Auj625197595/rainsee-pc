import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ThemeProvider} from 'styled-components';

import store from '../../store';
import {UIStyle} from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  HeaderTitle,
  List,
  Item,
  ItemLabel,
  Check,
  Footer,
  RestoreButton,
} from './style';

// 语言选择弹窗:点击某语言即翻译/切换到该语言(未开启则开启,已开启则重译)。
// 已开启时底部多出「显示原文」按钮。用自定义滚动列表而非原生 <select>,避免
// BrowserView 对原生下拉的裁剪。
export const App = observer(() => {
  return (
    <ThemeProvider theme={{...store.theme}}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <HeaderTitle>选择翻译语言</HeaderTitle>
        </Header>
        <List>
          {store.languages.map((l) => (
            <Item
              key={l.code}
              selected={l.code === store.target}
              onClick={() => store.chooseLanguage(l.code)}
            >
              <ItemLabel>{l.label}</ItemLabel>
              {l.code === store.target && <Check>✓</Check>}
            </Item>
          ))}
        </List>
        {store.active && (
          <Footer>
            <RestoreButton onClick={() => store.restore()}>显示原文</RestoreButton>
          </Footer>
        )}
      </StyledApp>
    </ThemeProvider>
  );
});
