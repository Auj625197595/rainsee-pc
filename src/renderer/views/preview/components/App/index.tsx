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
import { useI18n } from '~/renderer/components/I18n';

const formatMemory = (bytes: number) => {
  const t = useI18n();
  if (!bytes) return t('pvvReading');
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

export const App = observer(() => {
  const t = useI18n();
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
            <Thumbnail src={store.thumbnail} alt={t('pvvThumbAlt')} />
          ) : (
            <Placeholder favicon={store.favicon} />
          )}
          <MemoryBadge
            onClick={() => store.openMemoryPanel()}
            title={t('pvvViewAll')}
            aria-label={t('pvvMemoryAria', {
              memory: formatMemory(store.memory.memoryBytes),
            })}
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
