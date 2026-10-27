import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { ipcRenderer } from 'electron';

import { StyledApp } from './style';
import {
  Content,
  Header,
  HeaderText,
  Heading,
  Subtitle,
  HeaderActions,
  TextButton,
  IconButton,
  ListCard,
  Empty,
} from './panel';
import store from '../../store';
import { DownloadItem } from '../DownloadItem';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { getWebUIURL } from '~/common/webui';
import { useI18n } from '~/renderer/components/I18n';

// DialogBaseStyle 的上(3) + 下(16) 外边距,不计入 offsetHeight,上报时需补上。
const DIALOG_VERTICAL_MARGIN = 19;

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

const clearFinished = (e: React.MouseEvent) => {
  e.stopPropagation();
  store.clearFinished();
};

export const App = observer(() => {
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useI18n();
  const [scrolled, setScrolled] = React.useState(false);
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) =>
    setScrolled(e.currentTarget.scrollTop > 0);

  const items = store.downloads.slice().reverse();
  const active = store.downloads.filter(
    (x) => !x.completed && !x.canceled && !x.failed,
  ).length;
  const hasFinished = store.downloads.some(
    (x) => x.completed || x.canceled || x.failed,
  );

  // 只挂一次观察器:内容尺寸变化(增删任务、进度行出现/消失)即上报实际高度。
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let last = -1;
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + DIALOG_VERTICAL_MARGIN;
      if (h === last) return;
      last = h;
      ipcRenderer.send(`height-${store.id}`, h);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const subtitle =
    items.length === 0
      ? t('dldNoTasks')
      : t('dldCountSummary', {
          count: items.length,
          active: active > 0 ? t('dldActiveSuffix', { count: active }) : '',
        });

  const maxHeight =
    store.maxHeight > DIALOG_VERTICAL_MARGIN
      ? store.maxHeight - DIALOG_VERTICAL_MARGIN
      : undefined;

  return (
    <ThemeProvider
      theme={{ ...store.theme, dark: store.theme['dialog.lightForeground'] }}
    >
      <StyledApp
        ref={ref}
        style={maxHeight ? { maxHeight } : undefined}
        visible={store.visible}
      >
        <UIStyle />
        <Content>
          <Header scrolled={scrolled}>
            <HeaderText>
              <Heading>{t('dldTitle')}</Heading>
              <Subtitle>{subtitle}</Subtitle>
            </HeaderText>
            <HeaderActions>
              <IconButton
                type="button"
                aria-label={t('dldClear')}
                title={t('dldClear')}
                disabled={!hasFinished}
                onClick={clearFinished}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                </svg>
              </IconButton>
              <TextButton type="button" onClick={openAll}>
                {t('dldMore')}
              </TextButton>
              <IconButton
                type="button"
                aria-label={t('dldCloseAria')}
                title={t('dldCloseAria')}
                onClick={onClose}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </IconButton>
            </HeaderActions>
          </Header>

          <ListCard onScroll={onListScroll}>
            {items.length === 0 ? (
              <Empty>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                {t('dldEmpty')}
              </Empty>
            ) : (
              items.map((item) => <DownloadItem item={item} key={item.id} />)
            )}
          </ListCard>
        </Content>
      </StyledApp>
    </ThemeProvider>
  );
});
