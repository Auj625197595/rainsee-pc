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
import { useI18n } from '~/renderer/components/I18n';

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
  const t = useI18n();
  const statusTitle =
    status === 'clearing'
      ? t('cbdCleaningPage')
      : successful
      ? t('cbdPageDone')
      : status === 'unsupported'
      ? t('cbdPageUnsupported')
      : status === 'empty'
      ? t('cbdNothingSelected')
      : t('cbdPageFailed');

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <Title>{t('cbdTitle')}</Title>
          <IconButton title={t('cbdSettingsTitle')} onClick={() => store.openSettings()}>
            <GearSix size={17} weight="bold" />
          </IconButton>
        </Header>
        <Status $success={successful}>
          <StatusIcon $success={successful}>
            <StatusGlyph size={24} weight={successful ? 'fill' : 'bold'} />
          </StatusIcon>
          <StatusText>
            <StatusTitle>{statusTitle}</StatusTitle>
            <StatusDetail>{host || t('cbdOnlyWebsites')}</StatusDetail>
          </StatusText>
        </Status>
        <Footer>
          <ClearAllButton
            disabled={allStatus === 'clearing' || status === 'clearing'}
            onClick={onClearAll}
          >
            <GlobeHemisphereWest size={18} weight="bold" />
            {allStatus === 'clearing'
              ? t('cbdCleaningAll')
              : allStatus === 'success'
                ? t('cbdAllDone')
                : allStatus === 'error'
                  ? t('cbdAllFailed')
                  : allStatus === 'empty'
                    ? t('cbdNothingSelected')
                    : t('cbdCleanAll')}
          </ClearAllButton>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
