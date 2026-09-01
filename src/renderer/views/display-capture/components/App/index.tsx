import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Monitor, AppWindow } from '@phosphor-icons/react';
import { UIStyle } from '~/renderer/mixins/default-styles';
import store, { selectSource, submit, cancel, toggleAudio } from '../../store';
import { AppRoot, Header, Title, List, Item, Thumb, Main, Name, Meta, Empty, AudioOption, AudioCheckbox, Footer, Button } from './style';
import { useI18n } from '~/renderer/components/I18n';

export const App = observer(() => {
  const t = useI18n();
  return (
    <ThemeProvider theme={{...store.theme}}>
      <AppRoot>
        <UIStyle/>
        <Header>
          <Title>
            {t('dcShareRequest', { site: store.domain || t('dcSite') })}
          </Title>
        </Header>
        <List role="listbox" aria-label={t('dcScreensAria')}>
          <>
            {store.sources.length === 0 && <Empty>{t('dcEmpty')}</Empty>}
            {store.sources.map((source) => (
              <Item
                key={source.id}
                selected={store.selectedId === source.id}
                role="option"
                aria-selected={store.selectedId === source.id}
                onClick={() => selectSource(source.id)}
                onDoubleClick={() => {
                  selectSource(source.id);
                  submit();
                }}
              >
                <Thumb>
                  {source.thumbnail ? (
                    <img src={source.thumbnail} />
                  ) : source.type === 'screen' ? (
                    <Monitor size={24}/>
                  ) : (
                    <AppWindow size={24}/>
                  )}
                </Thumb>
                <Main>
                  <Name>{source.name}</Name>
                  <Meta>
                    {source.type === 'screen'
                      ? t('dcEntireScreen')
                      : t('dcWindow')}
                  </Meta>
                </Main>
              </Item>
            ))}
          </>
        </List>
        {store.audioAvailable && (
          <AudioOption>
            <AudioCheckbox
              type="checkbox"
              checked={store.shareAudio}
              onChange={toggleAudio}
            />
            {t('dcShareAudio')}
          </AudioOption>
        )}
        <Footer>
          <Button cancel onClick={cancel}>
            {t('cancel')}
          </Button>
          <Button disabled={!store.selectedId} onClick={submit}>
            {t('dcShare')}
          </Button>
        </Footer>
      </AppRoot>
    </ThemeProvider>
  );
});
