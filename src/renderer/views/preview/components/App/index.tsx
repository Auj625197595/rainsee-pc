import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  StyledApp,
  ImageWrap,
  Thumbnail,
  Placeholder,
  TextWrap,
  Title,
  Url,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';

export const App = observer(() => {
  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <StyledApp
        style={{ transform: `translate3d(${store.x}px, 0, 0)` }}
        xTransition={store.xTransition}
        visible={store.visible}
      >
        <ImageWrap>
          {store.thumbnail ? (
            <Thumbnail src={store.thumbnail} alt="标签页预览图" />
          ) : (
            <Placeholder favicon={store.favicon} />
          )}
        </ImageWrap>
        <TextWrap>
          <Title>{store.title}</Title>
          <Url>{store.displayUrl}</Url>
        </TextWrap>
      </StyledApp>
    </ThemeProvider>
  );
});
