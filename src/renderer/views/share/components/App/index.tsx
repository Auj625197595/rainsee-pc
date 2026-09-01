import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { clipboard } from 'electron';

import {
  StyledApp,
  Header,
  Title,
  Subtitle,
  CloseButton,
  QrCard,
  QrImage,
  QrPlaceholder,
  QrHint,
  QrDownloadButton,
  FieldLabel,
  LinkRow,
  LinkText,
  CopyButton,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

const onClose = () => store.hide();

const copy = (value: string) => () => {
  if (!value) return;
  clipboard.writeText(value);
  store.markCopied();
};

const onDownloadQr = () => store.downloadQr();

const DownloadGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M5 21h14" />
  </svg>
);

export const App = observer(() => {
  const t = useI18n();
  const qrText = store.loading
    ? t('shQrGenerating')
    : store.qrError || !store.qrUrl
      ? t('shQrFailed')
      : '';

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <div>
            <Title>{t('shTitle')}</Title>
            <Subtitle>{store.title || store.url || t('shCurrentPage')}</Subtitle>
          </div>
          <CloseButton type="button" onClick={onClose} aria-label={t('shCloseAria')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </CloseButton>
        </Header>

        <QrCard>
          {!store.loading && !store.qrError && store.qrUrl ? (
            <QrImage src={store.qrUrl} />
          ) : (
            <QrPlaceholder>{qrText}</QrPlaceholder>
          )}
          <QrHint>{t('shQrHint')}</QrHint>
          <QrDownloadButton
            type="button"
            disabled={store.loading || store.qrError || !store.qrUrl || store.downloading}
            onClick={onDownloadQr}
          >
            <DownloadGlyph />
            {store.downloading
              ? t('shSaving')
              : store.downloadHint || t('shDownloadQr')}
          </QrDownloadButton>
        </QrCard>

        <FieldLabel>{t('shShortLink')}</FieldLabel>
        <LinkRow>
          <LinkText>
            {store.loading
              ? t('shShortLinkGenerating')
              : store.shortError || !store.shortUrl
                ? t('shShortLinkFailed')
                : store.shortUrl}
          </LinkText>
          <CopyButton
            type="button"
            disabled={store.loading || store.shortError || !store.shortUrl}
            onClick={copy(store.shortUrl)}
          >
            {store.copied ? t('shCopied') : t('shCopy')}
          </CopyButton>
        </LinkRow>
      </StyledApp>
    </ThemeProvider>
  );
});
