import * as React from 'react';
import { ipcRenderer } from 'electron';
import { ThemeProvider } from 'styled-components';

import type {
  IMemoryProcessItem,
  IMemorySnapshot,
  MemoryProcessCategory,
} from '~/interfaces/memory';
import type { ISettings } from '~/interfaces';
import { DEFAULT_SETTINGS } from '~/constants';
import { getTheme } from '~/utils/themes';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import { Container } from '~/renderer/components/Pages';
import { GlobalNavigationDrawer } from '~/renderer/components/GlobalNavigationDrawer';
import {
  Page,
  MainScroll,
  Main,
  Header,
  HeaderCopy,
  Title,
  Subtitle,
  HeaderActions,
  LiveBadge,
  RefreshButton,
  Overview,
  OverviewMain,
  OverviewLabel,
  OverviewValue,
  OverviewMeta,
  OverviewStat,
  OverviewStatValue,
  OverviewStatLabel,
  Section,
  SectionHeader,
  SectionTitleWrap,
  SectionTitle,
  SectionHint,
  Filters,
  FilterButton,
  ProcessList,
  ProcessCard,
  ProcessIcon,
  ProcessMain,
  ProcessTop,
  ProcessIdentity,
  ProcessName,
  ProcessDescription,
  ProcessBadges,
  Badge,
  ProcessUsage,
  MemoryNumber,
  CpuNumber,
  UsageTrack,
  UsageFill,
  TabChips,
  TabChip,
  EmptyState,
  ErrorState,
} from './style';

type Filter = 'all' | 'tabs' | 'system';

const categoryMeta: Record<
  MemoryProcessCategory,
  { label: string; color: string }
> = {
  browser: { label: '浏览器', color: '#4968E8' },
  tab: { label: '网页', color: '#24A77A' },
  extension: { label: '扩展', color: '#9B61E8' },
  gpu: { label: '图形', color: '#E98A3D' },
  utility: { label: '服务', color: '#3F9EDB' },
  other: { label: '其他', color: '#8B96AC' },
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 1 : 2)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const formatCpu = (value: number) => {
  if (!Number.isFinite(value) || value < 0.05) return '<0.1% CPU';
  return `${value.toFixed(value >= 10 ? 0 : 1)}% CPU`;
};

const formatTime = (timestamp: number) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const ProcessGlyph = ({ category }: { category: MemoryProcessCategory }) => {
  if (category === 'tab') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18M7 6.5h.01M10 6.5h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (category === 'browser') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="M8 2v4M16 2v4M8 18v4M16 18v4M2 8h4M18 8h4M2 16h4M18 16h4" />
      </svg>
    );
  }
  if (category === 'gpu') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <path d="M4 17 8.5 7h7L20 17" />
        <path d="M6 13h12M8 20h8" strokeLinecap="round" />
      </svg>
    );
  }
  if (category === 'extension') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        <path d="M8 3h4v4a2 2 0 1 0 4 0V3h5v6h-4a2 2 0 1 0 0 4h4v8h-8v-4a2 2 0 1 0-4 0v4H3v-8h4a2 2 0 1 0 0-4H3V3h5Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.37.7.6 1 .3.38.69.6 1.1.6h.09v4h-.09c-.41 0-.8.22-1.1.6-.23.3-.44.63-.6 1Z" />
    </svg>
  );
};

const RefreshGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 11a8 8 0 1 0-2.35 5.65" />
    <path d="M20 4v7h-7" />
  </svg>
);

const ProcessRow = ({
  process,
  totalBytes,
}: {
  process: IMemoryProcessItem;
  totalBytes: number;
}) => {
  const meta = categoryMeta[process.category];
  const percent = totalBytes
    ? Math.max(0.6, Math.min(100, (process.memoryBytes / totalBytes) * 100))
    : 0;

  return (
    <ProcessCard>
      <ProcessIcon category={process.category}>
        <ProcessGlyph category={process.category} />
      </ProcessIcon>
      <ProcessMain>
        <ProcessTop>
          <ProcessIdentity>
            <ProcessName>{process.name}</ProcessName>
            <ProcessDescription>{process.description}</ProcessDescription>
            <ProcessBadges>
              <Badge color={meta.color}>{meta.label}</Badge>
              <Badge>PID {process.pid}</Badge>
              {process.serviceName && <Badge>{process.serviceName}</Badge>}
            </ProcessBadges>
          </ProcessIdentity>
          <ProcessUsage>
            <MemoryNumber>{formatBytes(process.memoryBytes)}</MemoryNumber>
            <CpuNumber>{formatCpu(process.cpuPercent)}</CpuNumber>
          </ProcessUsage>
        </ProcessTop>
        <UsageTrack>
          <UsageFill color={meta.color} style={{ width: `${percent}%` }} />
        </UsageTrack>
        {process.tabs.length > 0 && (
          <TabChips>
            {process.tabs.map((tab) => (
              <TabChip key={tab.id} selected={tab.selected} title={tab.url}>
                {tab.selected && <span>当前</span>}
                {tab.title || '未命名标签页'}
              </TabChip>
            ))}
          </TabChips>
        )}
        {process.tabs.length === 0 && process.contentLabels.length > 0 && (
          <TabChips>
            {process.contentLabels.slice(0, 4).map((label) => (
              <TabChip key={label}>{label}</TabChip>
            ))}
          </TabChips>
        )}
      </ProcessMain>
    </ProcessCard>
  );
};

const App = () => {
  // 用 lazy initializer 保证同步 IPC 只发生一次。此前函数体每次渲染都会
  // sendSync，自动刷新时会反复阻塞本页面和主进程。
  const [settings, setSettings] = React.useState<ISettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...ipcRenderer.sendSync('get-settings-sync'),
  }));
  const [snapshot, setSnapshot] = React.useState<IMemorySnapshot | null>(null);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const mountedRef = React.useRef(true);
  const refreshingRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    // 防止定时刷新、重新切回页面和手动点击在同一时刻叠加 IPC 请求。
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const next = (await ipcRenderer.invoke(
        'memory-get-snapshot',
      )) as IMemorySnapshot;
      if (!mountedRef.current) return;
      setSnapshot(next);
      setError('');
    } catch (reason) {
      if (!mountedRef.current) return;
      setError('暂时无法读取运行内存，请稍后重试。');
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    document.title = '内存使用情况';
    refresh();

    // 5 秒足以反映趋势，同时避免持续枚举进程；后台标签完全停止采集。
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  React.useEffect(() => {
    const onSettings = (_event: Electron.IpcRendererEvent, next: ISettings) => {
      setSettings((current) => ({ ...current, ...next }));
    };
    ipcRenderer.on('update-settings', onSettings);
    return () => ipcRenderer.removeListener('update-settings', onSettings);
  }, []);

  const processes = React.useMemo(() => {
    const list = snapshot?.processes || [];
    if (filter === 'tabs') {
      return list.filter(
        (item) => item.category === 'tab' || item.category === 'extension',
      );
    }
    if (filter === 'system') {
      return list.filter(
        (item) => item.category !== 'tab' && item.category !== 'extension',
      );
    }
    return list;
  }, [snapshot, filter]);

  const largest = snapshot?.processes?.[0];
  const updatedAt = snapshot ? formatTime(snapshot.timestamp) : '';

  return (
    <ThemeProvider theme={getTheme(settings.theme)}>
      <Container>
        <WebUIStyle />
        <GlobalNavigationDrawer />
        <Page>
          <MainScroll>
            <Main>
              <Header>
                <HeaderCopy>
                  <Title>内存使用情况</Title>
                  <Subtitle>查看浏览器和各进程当前占用的运行内存。</Subtitle>
                </HeaderCopy>
                <HeaderActions>
                  <LiveBadge>
                    <i />
                    自动刷新 {updatedAt && `· ${updatedAt}`}
                  </LiveBadge>
                  <RefreshButton onClick={refresh} disabled={loading}>
                    <RefreshGlyph />
                    刷新
                  </RefreshButton>
                </HeaderActions>
              </Header>

              <Overview>
                <OverviewMain>
                  <OverviewLabel>当前应用运行内存</OverviewLabel>
                  <OverviewValue>
                    {snapshot ? formatBytes(snapshot.totalBytes) : '读取中…'}
                  </OverviewValue>
                  <OverviewMeta>工作集内存，数值会随页面活动变化</OverviewMeta>
                </OverviewMain>
                <OverviewStat>
                  <OverviewStatValue>
                    {snapshot?.processCount || 0}
                  </OverviewStatValue>
                  <OverviewStatLabel>进程</OverviewStatLabel>
                </OverviewStat>
                <OverviewStat>
                  <OverviewStatValue>
                    {snapshot?.tabCount || 0}
                  </OverviewStatValue>
                  <OverviewStatLabel>标签页</OverviewStatLabel>
                </OverviewStat>
                <OverviewStat>
                  <OverviewStatValue>
                    {largest ? formatBytes(largest.memoryBytes) : '0 MB'}
                  </OverviewStatValue>
                  <OverviewStatLabel title={largest?.name || ''}>
                    最大进程
                  </OverviewStatLabel>
                </OverviewStat>
              </Overview>

              <Section>
                <SectionHeader>
                  <SectionTitleWrap>
                    <SectionTitle>进程明细</SectionTitle>
                    <SectionHint>
                      已按运行内存从高到低排列，共 {processes.length} 项
                    </SectionHint>
                  </SectionTitleWrap>
                  <Filters>
                    <FilterButton
                      selected={filter === 'all'}
                      onClick={() => setFilter('all')}
                    >
                      全部
                    </FilterButton>
                    <FilterButton
                      selected={filter === 'tabs'}
                      onClick={() => setFilter('tabs')}
                    >
                      网页与扩展
                    </FilterButton>
                    <FilterButton
                      selected={filter === 'system'}
                      onClick={() => setFilter('system')}
                    >
                      浏览器服务
                    </FilterButton>
                  </Filters>
                </SectionHeader>

                {error ? (
                  <ErrorState>
                    <strong>读取失败</strong>
                    <span>{error}</span>
                    <button onClick={refresh}>重新读取</button>
                  </ErrorState>
                ) : processes.length > 0 ? (
                  <ProcessList>
                    {processes.map((process) => (
                      <ProcessRow
                        key={process.pid}
                        process={process}
                        totalBytes={snapshot?.totalBytes || 0}
                      />
                    ))}
                  </ProcessList>
                ) : (
                  <EmptyState>
                    {loading ? '正在读取进程信息…' : '这个分类下暂无进程'}
                  </EmptyState>
                )}
              </Section>
            </Main>
          </MainScroll>
        </Page>
      </Container>
    </ThemeProvider>
  );
};

export default App;
