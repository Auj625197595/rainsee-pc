import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { ipcRenderer } from 'electron';

import { StyledApp } from './style';
import {
  TopGlow,
  Content,
  Header,
  Badge,
  Heading,
  Subtitle,
  CloseButton,
  ListCard,
  Empty,
  Footer,
} from './panel';
import store from '../../store';
import { DownloadItem } from '../DownloadItem';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getWebUIURL } from '~/common/webui';

const dialogClicked = (e: React.MouseEvent<HTMLDivElement>) => {
  store.closeAllDownloadMenu();
};

const onClose = (e: React.MouseEvent) => {
  e.stopPropagation();
  store.hide();
};

const openAll = (e: React.MouseEvent) => {
  e.stopPropagation();
  ipcRenderer.send(`add-tab-${store.windowId}`, {
    url: getWebUIURL('downloads'),
    active: true,
  });
  store.hide();
};

export const App = observer(() => {
  const ref = React.useRef<HTMLDivElement>(null);

  const items = store.downloads.slice().reverse();
  const active = store.downloads.filter(
    (x) => !x.completed && !x.canceled,
  ).length;
  const menuOpen = store.downloads.some((x) => x.menuIsOpen);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const report = () => {
      // 19px = DialogBaseStyle 的上(3) + 下(16) 外边距
      // 菜单展开时额外预留高度，避免被窗口边界裁切
      const extra = menuOpen ? 240 : 0;
      ipcRenderer.send(`height-${store.id}`, el.offsetHeight + 19 + extra);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  });

  const subtitle =
    items.length === 0
      ? '暂无下载任务'
      : `共 ${items.length} 项${active > 0 ? `,${active} 项进行中` : ''}`;

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['dialog.lightForeground'] }}
    >
      <StyledApp
        ref={ref}
        style={store.maxHeight ? { maxHeight: store.maxHeight } : undefined}
        visible={store.visible}
        menuOpen={menuOpen}
        onClick={dialogClicked}
      >
        <UIStyle />
        <TopGlow />
        <Content>
          <Header>
            <div>
              <Badge>Downloads</Badge>
              <Heading>下载列表</Heading>
              <Subtitle>{subtitle}</Subtitle>
            </div>
            <CloseButton aria-label="关闭下载列表" onClick={onClose}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </CloseButton>
          </Header>

          <ListCard menuOpen={menuOpen}>
            {items.length === 0 ? (
              <Empty>下载的文件会显示在这里</Empty>
            ) : (
              items.map((item) => (
                <DownloadItem item={item} key={item.id}></DownloadItem>
              ))
            )}
          </ListCard>

          <Footer onClick={openAll}>查看全部</Footer>
        </Content>
      </StyledApp>
    </ThemeProvider>
  );
});
