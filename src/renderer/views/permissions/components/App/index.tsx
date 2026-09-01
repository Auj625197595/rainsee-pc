import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  ArrowSquareOut,
  Gear as GearIcon,
} from '@phosphor-icons/react';

import {
  StyledApp,
  Header,
  HeaderMain,
  Eyebrow,
  Title,
  Domain,
  HeaderIconButton,
  Permissions,
  Permission,
  Footer,
  RememberLabel,
  RememberBox,
  Buttons,
  ActionButton,
  ExternalPrompt,
  ExternalIcon,
  ExternalMain,
  ExternalTitle,
  ExternalSource,
  ExternalActions,
  ExternalSettingsButton,
  ExternalOpenButton,
  ExternalProgress,
} from './style';
import store, {
  sendResult,
  isExternalNavigationRequest,
  openSettings,
  toggleRemember,
} from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getPermissionText } from '~/utils';
import { useI18n } from '~/renderer/components/I18n';

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 6.2 4.6 8.8 10 3.4"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const App = observer(() => {
  const t = useI18n();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const externalNavigation = isExternalNavigationRequest();

  React.useEffect(() => {
    if (!externalNavigation) return undefined;
    const timer = window.setTimeout(() => sendResult(false), 5000);
    return () => window.clearTimeout(timer);
  }, [externalNavigation, store.targetUrl]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || externalNavigation) return undefined;

    const report = () => {
      if (!root.isConnected) return;
      const h = Math.ceil(root.scrollHeight) + 6;
      store.send('resize-dialog', h);
    };

    report();

    const observer = new ResizeObserver(report);
    observer.observe(root);

    return () => observer.disconnect();
  }, [externalNavigation, store.domain, store.permissions.length, store.remember]);

  if (externalNavigation) {
    return (
      <ThemeProvider theme={{ ...store.theme }}>
        <ExternalPrompt>
          <UIStyle />
          <ExternalIcon>
            <ArrowSquareOut size={20} weight="bold" />
          </ExternalIcon>
          <ExternalMain>
            <ExternalTitle title={store.targetDomain}>
              {t('ppExternalRequest', { site: store.targetDomain || t('credCurrentSite') })}
            </ExternalTitle>
            <ExternalSource title={store.domain}>
              {t('ppFromSite', { site: store.domain || t('credCurrentSite') })}
            </ExternalSource>
          </ExternalMain>
          <ExternalActions>
            <ExternalSettingsButton
              type="button"
              title={t('ppOpenPermSettings')}
              aria-label={t('ppOpenPermSettings')}
              onClick={openSettings}
            >
              <GearIcon size={18} weight="bold" />
            </ExternalSettingsButton>
            <ExternalOpenButton type="button" onClick={() => sendResult(true)}>
              {t('extOpen')}
            </ExternalOpenButton>
          </ExternalActions>
          <ExternalProgress />
        </ExternalPrompt>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp ref={rootRef}>
        <UIStyle />
        <Header>
          <HeaderMain>
            <Eyebrow>{t('ppEyebrow')}</Eyebrow>
            <Title>{t('ppWantsAccess')}</Title>
            <Domain>{store.domain}</Domain>
          </HeaderMain>
          <HeaderIconButton title={t('ppSettingsTitle')} onClick={openSettings}>
            <GearIcon size={18} weight="bold" />
          </HeaderIconButton>
        </Header>

        <Permissions>
          {store.permissions.map((item) => (
            <Permission key={item}>{getPermissionText(item)}</Permission>
          ))}
        </Permissions>

        <Footer>
          <RememberLabel onClick={toggleRemember}>
            <RememberBox checked={store.remember}>
              <CheckIcon />
            </RememberBox>
            {t('ppRemember')}
          </RememberLabel>

          <Buttons>
            <ActionButton variant="primary" onClick={() => sendResult(true)}>
              {t('ppAllow')}
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => sendResult(false)}>
              {t('ppDeny')}
            </ActionButton>
          </Buttons>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
