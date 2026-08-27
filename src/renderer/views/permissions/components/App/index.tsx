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
              {store.targetDomain || '外部网站'} 请求跳转
            </ExternalTitle>
            <ExternalSource title={store.domain}>
              来自 {store.domain || '当前网站'}
            </ExternalSource>
          </ExternalMain>
          <ExternalActions>
            <ExternalSettingsButton
              type="button"
              title="打开此网站的权限设置"
              aria-label="打开此网站的权限设置"
              onClick={openSettings}
            >
              <GearIcon size={18} weight="bold" />
            </ExternalSettingsButton>
            <ExternalOpenButton type="button" onClick={() => sendResult(true)}>
              打开
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
            <Eyebrow>权限请求</Eyebrow>
            <Title>网站想访问以下能力</Title>
            <Domain>{store.domain}</Domain>
          </HeaderMain>
          <HeaderIconButton title="设置-权限管理" onClick={openSettings}>
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
            记住此选择
          </RememberLabel>

          <Buttons>
            <ActionButton variant="primary" onClick={() => sendResult(true)}>
              允许
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => sendResult(false)}>
              拒绝
            </ActionButton>
          </Buttons>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
