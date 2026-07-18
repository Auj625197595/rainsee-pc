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

  let primaryText = '立即更新';
  if (downloading) primaryText = `下载中 ${store.progress}%`;
  else if (downloaded) primaryText = '立即安装并重启';

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible} ref={rootRef}>
        <UIStyle />
        <Header>
          <TitleWrap>
            <Title>发现新版本</Title>
            <VersionLine>
              当前 v{store.currentVersion}
              <NewVersionTag>新版本 v{store.version}</NewVersionTag>
            </VersionLine>
          </TitleWrap>
          {!store.mandatory && <CloseButton onClick={onClose}>✕</CloseButton>}
        </Header>

        <NotesCard>
          <NotesTitle>更新内容</NotesTitle>
          <NotesScroll>
            {notes.length > 0 ? (
              notes.map((n, i) => <NoteItem key={i}>{n}</NoteItem>)
            ) : (
              <NoteItem>本次更新包含若干优化与修复。</NoteItem>
            )}
          </NotesScroll>
        </NotesCard>

        {(downloading || downloaded) && (
          <ProgressWrap>
            <ProgressLabel>
              <span>{downloaded ? '下载完成' : '正在下载更新'}</span>
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
              跳过此版本
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
