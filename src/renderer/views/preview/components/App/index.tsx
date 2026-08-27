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
  MemoryBadge,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';

const formatMemory = (bytes: number) => {
  if (!bytes) return '读取中';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

export const App = observer(() => {
  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <StyledApp
        style={{ transform: `translate3d(${store.x}px, 0, 0)` }}
        xTransition={store.xTransition}
        visible={store.visible}
        onMouseEnter={() => store.pointerEnter()}
        onMouseLeave={() => store.pointerLeave()}
      >
        <ImageWrap>
          {store.thumbnail ? (
            <Thumbnail src={store.thumbnail} alt="标签页预览图" />
          ) : (
            <Placeholder favicon={store.favicon} />
          )}
          <MemoryBadge
            onClick={() => store.openMemoryPanel()}
            title="查看全部"
            aria-label={`当前标签运行内存 ${formatMemory(
              store.memory.memoryBytes,
            )}，查看全部`}
          >
            <span>{formatMemory(store.memory.memoryBytes)}</span>
          </MemoryBadge>
        </ImageWrap>
        <TextWrap>
          <Title>{store.title}</Title>
          <Url>{store.displayUrl}</Url>
        </TextWrap>
      </StyledApp>
    </ThemeProvider>
  );
});
