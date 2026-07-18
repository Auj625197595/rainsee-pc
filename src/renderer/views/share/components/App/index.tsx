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
  const qrText = store.loading
    ? '正在生成二维码…'
    : store.qrError || !store.qrUrl
      ? '二维码生成失败'
      : '';

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <div>
            <Title>分享网页</Title>
            <Subtitle>{store.title || store.url || '当前网页'}</Subtitle>
          </div>
          <CloseButton type="button" onClick={onClose} aria-label="关闭分享弹窗">
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
          <QrHint>扫描二维码在手机上打开</QrHint>
          <QrDownloadButton
            type="button"
            disabled={store.loading || store.qrError || !store.qrUrl || store.downloading}
            onClick={onDownloadQr}
          >
            <DownloadGlyph />
            {store.downloading
              ? '保存中…'
              : store.downloadHint || '下载二维码'}
          </QrDownloadButton>
        </QrCard>

        <FieldLabel>短链接</FieldLabel>
        <LinkRow>
          <LinkText>
            {store.loading
              ? '正在生成短链接…'
              : store.shortError || !store.shortUrl
                ? '短链接生成失败'
                : store.shortUrl}
          </LinkText>
          <CopyButton
            type="button"
            disabled={store.loading || store.shortError || !store.shortUrl}
            onClick={copy(store.shortUrl)}
          >
            {store.copied ? '已复制' : '复制'}
          </CopyButton>
        </LinkRow>
      </StyledApp>
    </ThemeProvider>
  );
});
