import { ipcRenderer } from 'electron';
import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Key, Globe, Check, X } from '@phosphor-icons/react';
import { ThemeProvider } from 'styled-components';

import store from '../../store';
import { Textfield } from '~/renderer/components/Textfield';
import { PasswordInput } from '~/renderer/components/PasswordInput';
import List from '../List';
import {
  StyledApp,
  Header,
  HeaderIcon,
  HeaderText,
  Title,
  Subtitle,
  Site,
  SiteAddress,
  Container,
  FieldsSection,
  Buttons,
  PrimaryButton,
  SecondaryButton,
  ManageButton,
} from './style';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

const getSiteAddress = (url: string, fallback: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url || fallback;
  }
};

const onSave = () => {
  const username = store.usernameRef.current.value;
  const password = store.passwordRef.current.value;

  ipcRenderer.send(`credentials-save-${store.windowId}`, {
    username,
    password,
    url: store.url,
    content: store.content,
    credentialId: store.credentialId,
    sourceWebContentsId: store.sourceWebContentsId,
  });
};

const onClose = () => {
  ipcRenderer.send(`credentials-hide-${store.windowId}`);
};

const Fields = observer(() => {
  const t = useI18n();
  return (
    <FieldsSection $visible={store.content !== 'list'}>
      <Textfield
        ref={store.usernameRef}
        label={t('credUsername')}
        dark={!!store.theme['dialog.lightForeground']}
        style={{ width: '100%' }}
      />
      <PasswordInput
        ref={store.passwordRef}
        label={t('credPassword')}
        dark={!!store.theme['dialog.lightForeground']}
        style={{ width: '100%' }}
      />
    </FieldsSection>
  );
});

export const App = observer(() => {
  const t = useI18n();
  let title = '';

  if (store.content === 'list') {
    title = store.list.length
      ? 'Saved passwords for this site'
      : 'No passwords saved for this site';
  } else {
    title =
      store.content === 'save' ? t('credSaveTitle') : t('credUpdateTitle');
  }

  const siteAddress = getSiteAddress(store.url, t('credCurrentSite'));

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: !!store.theme['dialog.lightForeground'] }}
    >
      <StyledApp>
        <UIStyle />
        <Header>
          <HeaderIcon aria-hidden="true">
            <Key size={18} weight="bold" />
          </HeaderIcon>
          <HeaderText>
            <Title>{title}</Title>
            <Subtitle>
              {store.content === 'list'
                ? t('credManageHint')
                : t('credSaveHint')}
            </Subtitle>
          </HeaderText>
        </Header>
        <Site title={store.url}>
          <Globe size={14} weight="bold" aria-hidden="true" />
          <SiteAddress>{siteAddress}</SiteAddress>
        </Site>
        <Container>
          <Fields />
          <List />
        </Container>
        <Buttons>
          {store.content === 'list' ? (
            <ManageButton onClick={onClose} type="button">
              {t('credManage')}
            </ManageButton>
          ) : (
            <PrimaryButton onClick={onSave} type="button">
              <Check size={15} weight="bold" />
              {t('save')}
            </PrimaryButton>
          )}
          <SecondaryButton onClick={onClose} type="button">
            <X size={15} weight="bold" />
            {t('cancel')}
          </SecondaryButton>
        </Buttons>
      </StyledApp>
    </ThemeProvider>
  );
});
