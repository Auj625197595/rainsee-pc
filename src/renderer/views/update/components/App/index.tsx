import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import {
  StyledApp,
  Header,
  TitleWrap,
  Title,
  VersionLine,
  NewVersionTag,
  CloseButton,
  NotesCard,
  NotesTitle,
  NotesScroll,
  NoteItem,
  ProgressWrap,
  ProgressLabel,
  ProgressBar,
  ProgressFill,
  ErrorText,
  Actions,
  Button,
} from './style';
import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';

const onClose = () => {
  store.hide();
};

const onUpdate = () => {
  if (store.status === 'downloaded') {
    store.installNow();
  } else {
    store.startUpdate();
  }
};

const onSkip = () => {
  store.skipVersion();
};

export const App = observer(() => {
  const t = useI18n();
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 内容高度自适应: 测量后上报给主进程重排弹窗
  React.useEffect(() => {
    if (!rootRef.current) return undefined;
    const report = () => {
      const h = Math.ceil(rootRef.current.scrollHeight) + 6;
      store.send('resize-dialog', h);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [store.notes, store.status, store.progress, store.errorMsg]);

  const notes = (store.notes || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const downloading = store.status === 'downloading';
  const downloaded = store.status === 'downloaded';

  let primaryText = t('updInstallNow');
  if (downloading) primaryText = t('updDownloading', { percent: store.progress });
  else if (downloaded) primaryText = t('updReadyInstall');

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible} ref={rootRef}>
        <UIStyle />
        <Header>
          <TitleWrap>
            <Title>{t('updTitle')}</Title>
            <VersionLine>
              {t('updCurrentVersion', { version: store.currentVersion })}
              <NewVersionTag>
                {t('updNewTag', { version: store.version })}
              </NewVersionTag>
            </VersionLine>
          </TitleWrap>
          {!store.mandatory && <CloseButton onClick={onClose}>✕</CloseButton>}
        </Header>

        <NotesCard>
          <NotesTitle>{t('updNotesTitle')}</NotesTitle>
          <NotesScroll>
            {notes.length > 0 ? (
              notes.map((n, i) => <NoteItem key={i}>{n}</NoteItem>)
            ) : (
              <NoteItem>{t('updNoteDefault')}</NoteItem>
            )}
          </NotesScroll>
        </NotesCard>

        {(downloading || downloaded) && (
          <ProgressWrap>
            <ProgressLabel>
              <span>{downloaded ? t('updDownloadDone') : t('updDownloadingStatus')}</span>
              <span>{store.progress}%</span>
            </ProgressLabel>
            <ProgressBar>
              <ProgressFill percent={store.progress} />
            </ProgressBar>
          </ProgressWrap>
        )}

        {store.status === 'error' && <ErrorText>{store.errorMsg}</ErrorText>}

        <Actions>
          {!store.mandatory && !downloading && !downloaded && (
            <Button variant="ghost" onClick={onSkip}>
              {t('updSkipVersion')}
            </Button>
          )}
          <Button variant="primary" disabled={downloading} onClick={onUpdate}>
            {primaryText}
          </Button>
        </Actions>
      </StyledApp>
    </ThemeProvider>
  );
});
