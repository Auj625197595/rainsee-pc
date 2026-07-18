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
  ComplaintBanner,
} from './style';
import store from '../../store';
import {UIStyle} from '~/renderer/mixins/default-styles';
import {getWebUIURL} from '~/common/webui';

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

const onComplaint = () => {
  // 跳转到「误拦截申诉」uniapp 页(部署在 third.yjllq.com/h5),带当前域名预填
  const domain = store.domain || '';
  const url = `https://third.yjllq.com/h5/pages/extensionComplaint/adblockComplaint?lang=zh${
    domain ? `&domain=${encodeURIComponent(domain)}` : ''
  }`;
  ipcRenderer.send(`add-tab-${store.windowId}`, {url, active: true});
  store.hide();
};

export const App = observer(() => {
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
            <Title>广告过滤</Title>
            <Domain>{store.domain || '当前页面'}</Domain>
          </div>
          <HeaderActions>
            <HeaderIconButton
              onClick={onOpenSettings}
              title="设置-拦截保护"
            >
              <GearSixIcon size={18} weight="bold" />
            </HeaderIconButton>
            <CloseButton onClick={onClose}>✕</CloseButton>
          </HeaderActions>
        </Header>

        <StatRow>
          <StatCard>
            <StatLabel>本页拦截</StatLabel>
            <StatValue>{store.list.length}</StatValue>
          </StatCard>
          <StatCard>
            <StatLabel>规则总数</StatLabel>
            <StatValue>{store.filterCount}</StatValue>
          </StatCard>
        </StatRow>

        <StatusCard>
          <StatusRow>
            <StatusText>{enabled ? '已开启' : '已暂停（本站）'}</StatusText>
            <Badge paused={!enabled}>{enabled ? '拦截中' : '已暂停'}</Badge>
          </StatusRow>
          <ActionButtons>
            <PillButton onClick={onToggleSite}>
              {enabled ? '暂停此站拦截' : '恢复此站拦截'}
            </PillButton>
            <PillButton onClick={onMarkAd}>
              标记广告
            </PillButton>
          </ActionButtons>
        </StatusCard>

        {store.list.length > 0 && (
          <ComplaintBanner onClick={onComplaint} title="误拦截申诉">
            网站没有非法广告 误拦截申诉
          </ComplaintBanner>
        )}

        <ListCard>
          <ListHeader>
            <ListTitle>最近命中</ListTitle>
            <ListMeta>{`共 ${store.list.length} 条`}</ListMeta>
          </ListHeader>
          {store.list.length > 0 ? (
            <ListScroll>
              {store.list.map((item, i) => (
                <RequestItem key={i}>
                  <RequestHost>{item.url}</RequestHost>
                  <RequestFilter>{'被 ' + item.filter + ' 拦截'}</RequestFilter>
                </RequestItem>
              ))}
            </ListScroll>
          ) : (
            <ListScroll>
              <EmptyState>{enabled ? '本页暂无命中' : '本站已暂停拦截'}</EmptyState>
            </ListScroll>
          )}
        </ListCard>
      </StyledApp>
    </ThemeProvider>
  );
});
