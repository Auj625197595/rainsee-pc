import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ThemeProvider} from 'styled-components';
import {ipcRenderer} from 'electron';
import {GearSixIcon} from '@phosphor-icons/react';

import {
  StyledApp,
  Header,
  HeaderActions,
  Title,
  Domain,
  CloseButton,
  HeaderIconButton,
  StatRow,
  StatCard,
  StatLabel,
  StatValue,
  StatusCard,
  StatusRow,
  StatusText,
  Badge,
  ActionButtons,
  PillButton,
  ListCard,
  ListHeader,
  ListTitle,
  ListMeta,
  ListScroll,
  RequestItem,
  RequestHost,
  RequestFilter,
  EmptyState,
} from './style';
import store from '../../store';
import {UIStyle} from '~/renderer/mixins/default-styles';
import {getWebUIURL} from '~/common/webui';
import { useI18n } from '~/renderer/components/I18n';

const onClose = () => {
  store.hide();
};

const onToggleSite = () => {
  store.toggleSite();
};

const onOpenSettings = () => {
  // 跳转到设置页的拦截保护分区
  ipcRenderer.send(`add-tab-${store.windowId}`, {
    url: `${getWebUIURL('settings')}?section=privacy`,
    active: true,
  });
  store.hide();
};

const onMarkAd = () => {
  // 先关弹窗，再在当前网页上启动元素拾取器(覆盖层在网页内，不在弹窗里)
  ipcRenderer.send(`start-adblock-picker-${store.windowId}`);
  store.hide();
};


export const App = observer(() => {
  const t = useI18n();
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 内容高度自适应：测量后上报给主进程重排弹窗
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
  }, [store.list.length, store.siteEnabled]);

  const enabled = store.siteEnabled;

  return (
    <ThemeProvider theme={{...store.theme}}>
      <StyledApp visible={store.visible} ref={rootRef}>
        <UIStyle/>
        <Header>
          <div>
            <Title>{t('sbTitle')}</Title>
            <Domain>{store.domain || t('sbCurrentPage')}</Domain>
          </div>
          <HeaderActions>
            <HeaderIconButton
              onClick={onOpenSettings}
              title={t('sbSettingsTitle')}
            >
              <GearSixIcon size={18} weight="bold" />
            </HeaderIconButton>
            <CloseButton onClick={onClose}>✕</CloseButton>
          </HeaderActions>
        </Header>

        <StatRow>
          <StatCard>
            <StatLabel>{t('sbBlockedHere')}</StatLabel>
            <StatValue>{store.list.length}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>{t('sbRulesTotal')}</StatLabel>
            <StatValue>{store.filterCount}</StatValue>
          </StatCard>
        </StatRow>

        <StatusCard>
          <StatusRow>
            <StatusText>{enabled ? t('sbOn') : t('sbPausedSite')}</StatusText>
            <Badge paused={!enabled}>{enabled ? t('sbBlocking') : t('sbPaused')}</Badge>
          </StatusRow>
          <ActionButtons>
            <PillButton onClick={onToggleSite}>
              {enabled ? t('sbToggleOff') : t('sbToggleOn')}
            </PillButton>
            <PillButton onClick={onMarkAd}>
              {t('sbMarkAds')}
            </PillButton>
          </ActionButtons>
        </StatusCard>

        <ListCard>
          <ListHeader>
            <ListTitle>{t('sbRecentHits')}</ListTitle>
            <ListMeta>{t('sbTotalCount', { count: store.list.length })}</ListMeta>
          </ListHeader>
          {store.list.length > 0 ? (
            <ListScroll>
              {store.list.map((item, i) => (
                <RequestItem key={i}>
                  <RequestHost>{item.url}</RequestHost>
                  <RequestFilter>{t('sbBlockedBy', { filter: item.filter })}</RequestFilter>
                </RequestItem>
              ))}
            </ListScroll>
          ) : (
            <ListScroll>
              <EmptyState>{enabled ? t('sbNoHits') : t('sbSitePaused')}</EmptyState>
            </ListScroll>
          )}
        </ListCard>
      </StyledApp>
    </ThemeProvider>
  );
});
