import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  Broom,
  CheckCircle,
  GearSix,
  GlobeHemisphereWest,
  WarningCircle,
} from '@phosphor-icons/react';

import store, { ClearDialogData } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  Title,
  IconButton,
  Status,
  StatusIcon,
  StatusText,
  StatusTitle,
  StatusDetail,
  Footer,
  ClearAllButton,
} from './style';

type StatusState = 'clearing' | 'success' | 'error' | 'unsupported' | 'empty';
type AllStatusState = 'idle' | 'clearing' | 'success' | 'error' | 'empty';

const hostFromUrl = (rawUrl: string) => {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
};

export const App = observer(() => {
  const [status, setStatus] = React.useState<StatusState>('clearing');
  const [host, setHost] = React.useState('');
  const [allStatus, setAllStatus] = React.useState<AllStatusState>('idle');
  const requestId = React.useRef(0);

  React.useEffect(
    () =>
      store.subscribeOpen(async (data: ClearDialogData) => {
        const currentRequest = ++requestId.current;
        setStatus('clearing');
        setHost(hostFromUrl(data.url));
        setAllStatus('idle');
        try {
          const result = await store.clearCurrent(data);
          if (currentRequest !== requestId.current) return;
          if (result?.unsupported) setStatus('unsupported');
          else if (result?.skipped) setStatus('empty');
          else setStatus(result?.ok ? 'success' : 'error');
        } catch {
          if (currentRequest !== requestId.current) return;
          setStatus('error');
        }
      }),
    [],
  );

  const onClearAll = async () => {
    if (allStatus === 'clearing' || status === 'clearing') return;
    setAllStatus('clearing');
    try {
      const result = await store.clearAll();
      if (result?.skipped) setAllStatus('empty');
      else setAllStatus(result?.ok ? 'success' : 'error');
    } catch {
      setAllStatus('error');
    }
  };

  const successful = status === 'success';
  const StatusGlyph = successful
    ? CheckCircle
    : status === 'clearing'
    ? Broom
    : WarningCircle;
  const statusTitle =
    status === 'clearing'
      ? '正在清理当前页面...'
      : successful
      ? '当前页面清理成功'
      : status === 'unsupported'
      ? '当前页面不支持清理'
      : status === 'empty'
      ? '尚未勾选清理类型'
      : '当前页面清理失败';

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <Title>清理浏览数据</Title>
          <IconButton title="清理设置" onClick={() => store.openSettings()}>
            <GearSix size={17} weight="bold" />
          </IconButton>
        </Header>
        <Status $success={successful}>
          <StatusIcon $success={successful}>
            <StatusGlyph size={24} weight={successful ? 'fill' : 'bold'} />
          </StatusIcon>
          <StatusText>
            <StatusTitle>{statusTitle}</StatusTitle>
            <StatusDetail>{host || '仅支持普通网站页面'}</StatusDetail>
          </StatusText>
        </Status>
        <Footer>
          <ClearAllButton
            disabled={allStatus === 'clearing' || status === 'clearing'}
            onClick={onClearAll}
          >
            <GlobeHemisphereWest size={18} weight="bold" />
            {allStatus === 'clearing'
              ? '正在清理全部网页数据...'
              : allStatus === 'success'
                ? '全部网页数据清理成功'
                : allStatus === 'error'
                  ? '全部网页数据清理失败'
                  : allStatus === 'empty'
                    ? '尚未勾选清理类型'
                    : '清理全部网页数据'}
          </ClearAllButton>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
