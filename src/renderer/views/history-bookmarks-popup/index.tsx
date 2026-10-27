import * as React from 'react';
import { clipboard, ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { observable, makeObservable, runInAction } from 'mobx';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  BookmarksSimpleIcon,
  CaretDown,
  CaretRight,
  ClockCounterClockwiseIcon,
  FolderSimple,
  GlobeSimple,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';

import { DialogStore } from '~/models/dialog-store';
import { IBookmark, IHistoryItem } from '~/interfaces';
import type { Translator } from '~/common/i18n';
import { getIconByUrlNet } from '~/utils/url';
import { UIStyle } from '~/renderer/mixins/default-styles';
import styled, { keyframes } from 'styled-components';
import { renderUI } from '~/utils/ui-entry';
import { useI18n } from '~/renderer/components/I18n';

type Kind = 'history' | 'bookmarks';

// 主渲染进程 TabsStore 的「最近关闭」快照(随弹窗打开下发,弹窗内只读)。
interface ClosedTab {
  id: number;
  url: string;
  title: string;
  favicon: string;
  closedAt: number;
}

const CLOSED_COLLAPSED_COUNT = 3;
const CLOSED_EXPANDED_STORAGE_KEY =
  'history-bookmarks-popup.closed-expanded.v1';

const EXPANDED_FOLDERS_STORAGE_KEY =
  'history-bookmarks-popup.expanded-folders.v1';
const scrollStorageKey = (kind: Kind) =>
  `history-bookmarks-popup.scroll-top.${kind}.v1`;
const SCROLL_PERSIST_DELAY = 200;

const readExpandedFolders = (): Set<string> => {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY) || '[]',
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string' && !!id)
        : [],
    );
  } catch {
    return new Set();
  }
};

const persistExpandedFolders = (folders: Set<string>) => {
  try {
    window.localStorage.setItem(
      EXPANDED_FOLDERS_STORAGE_KEY,
      JSON.stringify(Array.from(folders)),
    );
  } catch {
    // 持久化不可用时保留当前会话状态，不影响弹窗使用。
  }
};

const readScrollTop = (kind: Kind): number => {
  try {
    const value = Number(window.localStorage.getItem(scrollStorageKey(kind)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

const persistScrollTop = (kind: Kind, scrollTop: number) => {
  try {
    window.localStorage.setItem(
      scrollStorageKey(kind),
      String(Math.max(0, Math.round(scrollTop))),
    );
  } catch {
    // localStorage 异常不应阻断滚动。
  }
};

class Store extends DialogStore {
  public kind: Kind = 'history';
  public closed: ClosedTab[] = [];

  public constructor() {
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });
    makeObservable(this, { kind: observable, closed: observable.ref });
    ipcRenderer.on(
      'visible',
      (
        _event,
        visible: boolean,
        data?: { kind?: Kind; closed?: ClosedTab[] },
      ) => {
        runInAction(() => {
          this.kind = data?.kind === 'bookmarks' ? 'bookmarks' : 'history';
          if (visible) {
            this.closed = Array.isArray(data?.closed)
              ? data.closed.filter((t) => t && t.url)
              : [];
          }
          this.visible = visible;
        });
      },
    );
  }

  public enter() {
    this.send('history-bookmarks-popup-hover-enter');
  }

  public leave() {
    this.send('history-bookmarks-popup-hover-leave');
  }

  public openUrl(
    url: string,
    target: 'current' | 'new' | 'background' = 'current',
  ) {
    ipcRenderer.send(
      `history-bookmarks-popup-open-url-${this.windowId}`,
      url,
      target,
    );
    this.hide();
  }

  // 恢复最近关闭的标签:快照只在主窗口 TabsStore,经主进程按 id 回传恢复。
  public restoreClosed(ids: number[]) {
    if (!ids.length) return;
    const set = new Set(ids);
    runInAction(() => {
      this.closed = this.closed.filter((t) => !set.has(t.id));
    });
    ipcRenderer.send(
      `history-bookmarks-popup-restore-closed-${this.windowId}`,
      ids,
    );
  }

  public openManager() {
    ipcRenderer.send(
      `history-bookmarks-popup-open-manager-${this.windowId}`,
      this.kind,
    );
    this.hide();
  }

  public close() {
    this.hide();
  }
}

const store = new Store();
const MAX_HISTORY_ITEMS = 30;

const resolveIcon = (favicon: string | undefined, url: string | undefined) =>
  favicon && /^(data:|https?:|file:)/i.test(favicon)
    ? favicon
    : url
    ? getIconByUrlNet(url)
    : '';

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
};

const ago = (date: number, t: (key: string, params?: any) => string) => {
  const time = new Date(date).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return t('hbpJustNow');
  if (minutes < 60) return t('hbpMinutesAgo', { count: minutes });
  if (minutes < 24 * 60)
    return t('hbpHoursAgo', { count: Math.floor(minutes / 60) });
  const d = new Date(date);
  return t('hbpDate', { month: d.getMonth() + 1, day: d.getDate() });
};

type BookmarkTreeItem = IBookmark & { level: number };

const rootTitle = (item: IBookmark, t: Translator) => {
  switch (item.static) {
    case 'main':
      return t('hbpBookmarkBar');
    case 'other':
      return t('hbpOtherBookmarks');
    case 'mobile':
      return t('hbpMobileBookmarks');
    default:
      return item.title || t('hbpBookmark');
  }
};

const bookmarkTree = (
  items: IBookmark[],
  expanded: Set<string>,
  t: Translator,
): BookmarkTreeItem[] => {
  const roots = items
    .filter(
      (item) =>
        !!item._id &&
        !!item.isFolder &&
        (item.static === 'main' ||
          item.static === 'other' ||
          item.static === 'mobile'),
    )
    .sort((a, b) => {
      const rank = { main: 0, other: 1, mobile: 2 } as Record<string, number>;
      return (rank[a.static || ''] ?? 9) - (rank[b.static || ''] ?? 9);
    });
  const children = new Map<string, IBookmark[]>();
  items.forEach((item) => {
    if (!item.parent) return;
    const list = children.get(item.parent) || [];
    list.push(item);
    children.set(item.parent, list);
  });
  children.forEach((list) =>
    list.sort((a, b) => (a.order || 0) - (b.order || 0)),
  );

  const result: BookmarkTreeItem[] = [];
  const visit = (item: IBookmark, level: number) => {
    result.push({
      ...item,
      title: level === 0 ? rootTitle(item, t) : item.title,
      level,
    });
    if (!item.isFolder || !item._id || !expanded.has(item._id)) return;
    (children.get(item._id) || []).forEach((child) => visit(child, level + 1));
  };
  roots.forEach((root) => visit(root, 0));
  return result;
};

const App = observer(() => {
  const t = useI18n();
  const [history, setHistory] = React.useState<IHistoryItem[]>([]);
  const [bookmarks, setBookmarks] = React.useState<IBookmark[]>([]);
  const [expandedFolders, setExpandedFolders] =
    React.useState<Set<string>>(readExpandedFolders);
  const [query, setQuery] = React.useState('');
  const [closedExpanded, setClosedExpanded] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CLOSED_EXPANDED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleClosedExpanded = React.useCallback(() => {
    setClosedExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          CLOSED_EXPANDED_STORAGE_KEY,
          next ? '1' : '0',
        );
      } catch {
        // 持久化不可用时仅保留当前会话状态。
      }
      return next;
    });
  }, []);
  const [engaged, setEngaged] = React.useState(false);
  const engageTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const engagedRef = React.useRef(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollPositionsRef = React.useRef<Record<Kind, number>>({
    history: readScrollTop('history'),
    bookmarks: readScrollTop('bookmarks'),
  });
  const pendingScrollWritesRef = React.useRef<Partial<Record<Kind, number>>>(
    {},
  );
  const scrollPersistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isHistory = store.kind === 'history';

  const flushScrollMemory = React.useCallback(() => {
    if (scrollPersistTimer.current) {
      clearTimeout(scrollPersistTimer.current);
      scrollPersistTimer.current = null;
    }
    const pending = pendingScrollWritesRef.current;
    pendingScrollWritesRef.current = {};
    (Object.keys(pending) as Kind[]).forEach((kind) => {
      const scrollTop = pending[kind];
      if (scrollTop != null) persistScrollTop(kind, scrollTop);
    });
  }, []);

  const handleListScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      // 搜索词不会被记忆，因此搜索结果的滚动也不能覆盖常规列表位置。
      if (query.trim()) return;
      const kind = store.kind;
      const scrollTop = event.currentTarget.scrollTop;
      scrollPositionsRef.current[kind] = scrollTop;
      pendingScrollWritesRef.current[kind] = scrollTop;
      if (scrollPersistTimer.current) clearTimeout(scrollPersistTimer.current);
      scrollPersistTimer.current = setTimeout(
        flushScrollMemory,
        SCROLL_PERSIST_DELAY,
      );
    },
    [flushScrollMemory, query],
  );

  const clearEngageTimer = React.useCallback(() => {
    if (engageTimer.current) {
      clearTimeout(engageTimer.current);
      engageTimer.current = null;
    }
  }, []);

  const handleEnter = React.useCallback(() => {
    store.enter();
    clearEngageTimer();
    if (engagedRef.current) return;
    engageTimer.current = setTimeout(() => {
      engageTimer.current = null;
      engagedRef.current = true;
      setEngaged(true);
    }, 450);
  }, [clearEngageTimer]);

  const handleLeave = React.useCallback(() => {
    clearEngageTimer();
    if (!engagedRef.current) store.leave();
  }, [clearEngageTimer]);

  const toggleFolder = React.useCallback((id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistExpandedFolders(next);
      return next;
    });
  }, []);

  const removeItem = React.useCallback(
    (item: IHistoryItem | BookmarkTreeItem) => {
      if (!item._id) return;

      if (isHistory) {
        const id = item._id;
        setHistory((current) => current.filter((entry) => entry._id !== id));
        ipcRenderer.send('history-remove', [id]);
        return;
      }

      const id = item._id;
      setBookmarks((current) => {
        const removed = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          current.forEach((entry) => {
            if (entry.parent && removed.has(entry.parent) && entry._id) {
              if (!removed.has(entry._id)) {
                removed.add(entry._id);
                changed = true;
              }
            }
          });
        }
        return current.filter((entry) => !entry._id || !removed.has(entry._id));
      });
      ipcRenderer.send('bookmarks-remove', [id]);
    },
    [isHistory],
  );

  const showItemContextMenu = React.useCallback(
    (event: React.MouseEvent, item: IHistoryItem | BookmarkTreeItem) => {
      event.preventDefault();
      event.stopPropagation();
      // Opening a native menu moves the pointer outside this BrowserView. Lock
      // the popup for the duration of that interaction so it cannot disappear.
      clearEngageTimer();
      engagedRef.current = true;
      setEngaged(true);

      const url = item.url || '';
      const isFolder = 'isFolder' in item && !!item.isFolder;
      const menuItems: Electron.MenuItemConstructorOptions[] = [];
      if (isFolder) {
        const folder = item as BookmarkTreeItem;
        menuItems.push({
          label: expandedFolders.has(folder._id || '')
            ? t('hbpCollapseFolder')
            : t('hbpExpandFolder'),
          click: () => folder._id && toggleFolder(folder._id),
        });
      } else if (url) {
        menuItems.push(
          {
            label: t('hbpOpenCurrent'),
            click: () => store.openUrl(url),
          },
          {
            label: t('hbpOpenNewTab'),
            click: () => store.openUrl(url, 'new'),
          },
          {
            label: t('hbpOpenNewTabBg'),
            click: () => store.openUrl(url, 'background'),
          },
          { type: 'separator' },
          {
            label: t('hbpCopyLink'),
            click: () => clipboard.writeText(url),
          },
        );
      }
      const canDelete = isHistory || !('static' in item && item.static);
      if (item._id && canDelete) {
        menuItems.push(
          { type: 'separator' },
          {
            label: t('hbpDelete'),
            click: () => removeItem(item),
          },
        );
      }
      if (menuItems.length) remote.Menu.buildFromTemplate(menuItems).popup();
    },
    [clearEngageTimer, expandedFolders, isHistory, removeItem, toggleFolder],
  );

  const showClosedContextMenu = React.useCallback(
    (event: React.MouseEvent, item: ClosedTab) => {
      event.preventDefault();
      event.stopPropagation();
      clearEngageTimer();
      engagedRef.current = true;
      setEngaged(true);
      remote.Menu.buildFromTemplate([
        {
          label: t('hbpRestoreTab'),
          click: () => store.restoreClosed([item.id]),
        },
        {
          label: t('hbpOpenCurrent'),
          click: () => store.openUrl(item.url),
        },
        { type: 'separator' },
        {
          label: t('hbpCopyLink'),
          click: () => clipboard.writeText(item.url),
        },
      ]).popup();
    },
    [clearEngageTimer, t],
  );

  React.useEffect(() => {
    if (store.visible) return;
    flushScrollMemory();
    clearEngageTimer();
    engagedRef.current = false;
    setEngaged(false);
  }, [clearEngageTimer, flushScrollMemory, store.visible]);

  React.useEffect(() => {
    flushScrollMemory();
    clearEngageTimer();
    engagedRef.current = false;
    setEngaged(false);
  }, [clearEngageTimer, flushScrollMemory, store.kind]);

  React.useEffect(
    () => () => {
      clearEngageTimer();
      flushScrollMemory();
    },
    [clearEngageTimer, flushScrollMemory],
  );
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!store.visible) return;
    setQuery('');
    let active = true;
    setLoading(true);
    const task =
      store.kind === 'history'
        ? ipcRenderer.invoke('history-get').then((items) => {
            if (!active) return;
            setHistory(
              (Array.isArray(items) ? items : [])
                .filter((x) => x?.url)
                .sort((a, b) => (b.date || 0) - (a.date || 0))
                .slice(0, MAX_HISTORY_ITEMS),
            );
          })
        : ipcRenderer.invoke('bookmarks-get').then((items) => {
            if (active) {
              const nextBookmarks = Array.isArray(items) ? items : [];
              const folderIds = new Set(
                nextBookmarks
                  .filter((item) => item?.isFolder && item._id)
                  .map((item) => item._id as string),
              );
              const restoredFolders = new Set(
                Array.from(readExpandedFolders()).filter((id) =>
                  folderIds.has(id),
                ),
              );
              setBookmarks(nextBookmarks);
              setExpandedFolders(restoredFolders);
              persistExpandedFolders(restoredFolders);
            }
          });
    void task.finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [store.visible, store.kind]);

  React.useLayoutEffect(() => {
    if (!store.visible || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = scrollPositionsRef.current[store.kind];
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, store.kind, store.visible]);

  const visibleBookmarks = React.useMemo(
    () => bookmarkTree(bookmarks, expandedFolders, t),
    [bookmarks, expandedFolders, t],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredHistory = React.useMemo(
    () =>
      normalizedQuery
        ? history.filter((item) =>
            [item.title, item.url, host(item.url || '')]
              .filter(Boolean)
              .some((value) =>
                String(value).toLowerCase().includes(normalizedQuery),
              ),
          )
        : history,
    [history, normalizedQuery],
  );
  const filteredBookmarks = React.useMemo(() => {
    if (!normalizedQuery) return visibleBookmarks;
    const allExpanded = new Set(
      bookmarks
        .filter((item) => item.isFolder && item._id)
        .map((item) => item._id as string),
    );
    return bookmarkTree(bookmarks, allExpanded, t).filter((item) =>
      [item.title, item.url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [bookmarks, normalizedQuery, visibleBookmarks, t]);
  const closedTabs = store.closed;
  const filteredClosed = React.useMemo(
    () =>
      normalizedQuery
        ? closedTabs.filter((item) =>
            [item.title, item.url, host(item.url)]
              .filter(Boolean)
              .some((value) =>
                String(value).toLowerCase().includes(normalizedQuery),
              ),
          )
        : closedTabs,
    [normalizedQuery, closedTabs],
  );
  // 搜索时展开全部匹配项,方便直接定位。
  const showAllClosed = closedExpanded || !!normalizedQuery;
  const visibleClosed = showAllClosed
    ? filteredClosed
    : filteredClosed.slice(0, CLOSED_COLLAPSED_COUNT);
  const hiddenClosedCount = filteredClosed.length - visibleClosed.length;
  const items = isHistory ? filteredHistory : filteredBookmarks;
  const title = isHistory ? t('pvItemHistory') : t('shellFavorites');

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <Root
        onMouseEnter={handleEnter}
        onMouseDown={handleEnter}
        onFocusCapture={handleEnter}
        onMouseLeave={handleLeave}
      >
        <UIStyle />
        <Panel>
          <Header>
            <HeaderIcon>
              {isHistory ? (
                <ClockCounterClockwiseIcon size={17} weight="bold" />
              ) : (
                <BookmarksSimpleIcon size={17} weight="bold" />
              )}
            </HeaderIcon>
            <HeaderTitle>{title}</HeaderTitle>
            {engaged && (
              <CloseButton
                type="button"
                title={t('close')}
                aria-label={t('close')}
                onClick={() => store.close()}
              >
                <X size={16} weight="bold" />
              </CloseButton>
            )}
          </Header>
          <SearchBox>
            <SearchIcon>
              <MagnifyingGlass size={15} weight="bold" />
            </SearchIcon>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isHistory ? t('histSearchPlaceholder') : t('bmSearchFolder')
              }
              spellCheck={false}
            />
          </SearchBox>
          <List ref={listRef} onScroll={handleListScroll}>
            {isHistory && filteredClosed.length > 0 && (
              <ClosedSection aria-label={t('hbpRecentlyClosed')}>
                <SectionHeader>
                  <SectionTitle>
                    <ArrowCounterClockwise size={13} weight="bold" />
                    {t('hbpRecentlyClosed')}
                    <SectionCount>{filteredClosed.length}</SectionCount>
                  </SectionTitle>
                  {filteredClosed.length > 1 && (
                    <SectionAction
                      type="button"
                      onClick={() =>
                        store.restoreClosed(filteredClosed.map((x) => x.id))
                      }
                    >
                      {t('hbpRestoreAll')}
                    </SectionAction>
                  )}
                </SectionHeader>
                {visibleClosed.map((item, index) => {
                  const icon = resolveIcon(item.favicon, item.url);
                  return (
                    <ClosedRow
                      key={item.id}
                      type="button"
                      style={{ animationDelay: `${index * 28}ms` }}
                      onClick={() => store.restoreClosed([item.id])}
                      onContextMenu={(event) =>
                        showClosedContextMenu(event, item)
                      }
                      title={`${t('hbpRestoreTab')}\n${item.url}`}
                    >
                      <ClosedIcon>
                        {icon ? (
                          <img src={icon} alt="" />
                        ) : (
                          <GlobeSimple size={16} />
                        )}
                      </ClosedIcon>
                      <RowText>
                        <RowTitle>{item.title || host(item.url)}</RowTitle>
                        <RowSub>{host(item.url)}</RowSub>
                      </RowText>
                      <ClosedMeta>{ago(item.closedAt, t)}</ClosedMeta>
                      <RestoreBadge aria-hidden>
                        <ArrowCounterClockwise size={14} weight="bold" />
                      </RestoreBadge>
                    </ClosedRow>
                  );
                })}
                {!normalizedQuery &&
                  filteredClosed.length > CLOSED_COLLAPSED_COUNT && (
                    <MoreButton
                      type="button"
                      aria-expanded={closedExpanded}
                      onClick={toggleClosedExpanded}
                    >
                      {closedExpanded
                        ? t('hbpCollapseClosed')
                        : t('hbpShowMoreClosed', { count: hiddenClosedCount })}
                      <MoreCaret $open={closedExpanded}>
                        <CaretDown size={11} weight="bold" />
                      </MoreCaret>
                    </MoreButton>
                  )}
                <SectionDivider>{t('pvItemHistory')}</SectionDivider>
              </ClosedSection>
            )}
            {loading ? (
              <Empty>{t('hbpLoading')}</Empty>
            ) : !items.length ? (
              <Empty>
                {isHistory ? t('hbpNoHistory') : t('hbpNoBookmarks')}
              </Empty>
            ) : isHistory ? (
              filteredHistory.map((item) => (
                <Row
                  key={item._id}
                  onClick={() => store.openUrl(item.url || '')}
                  onContextMenu={(event) => showItemContextMenu(event, item)}
                  title={item.url}
                >
                  <RowIcon>
                    {resolveIcon(item.favicon, item.url) ? (
                      <img src={resolveIcon(item.favicon, item.url)} alt="" />
                    ) : (
                      <GlobeSimple size={18} />
                    )}
                  </RowIcon>
                  <RowText>
                    <RowTitle>{item.title || host(item.url || '')}</RowTitle>
                    <RowSub>{host(item.url || '')}</RowSub>
                  </RowText>
                  <Meta>{ago(item.date || 0, t)}</Meta>
                </Row>
              ))
            ) : (
              filteredBookmarks.map((item) => (
                <Row
                  key={item._id}
                  $level={item.level}
                  onClick={() =>
                    item.isFolder && item._id
                      ? toggleFolder(item._id)
                      : item.url && store.openUrl(item.url)
                  }
                  onContextMenu={(event) => showItemContextMenu(event, item)}
                  title={item.url || item.title}
                >
                  <RowIcon>
                    {item.isFolder ? (
                      expandedFolders.has(item._id || '') ? (
                        <CaretDown size={14} weight="bold" />
                      ) : (
                        <CaretRight size={14} weight="bold" />
                      )
                    ) : resolveIcon(item.favicon, item.url) ? (
                      <img src={resolveIcon(item.favicon, item.url)} alt="" />
                    ) : (
                      <GlobeSimple size={18} />
                    )}
                  </RowIcon>
                  <RowText>
                    <RowTitle>{item.title || item.url}</RowTitle>
                    {!item.isFolder && <RowSub>{host(item.url || '')}</RowSub>}
                  </RowText>
                  {item.isFolder ? (
                    <FolderSimple size={18} />
                  ) : (
                    <ArrowSquareOut size={14} />
                  )}
                </Row>
              ))
            )}
          </List>
          <Footer onClick={() => store.openManager()}>
            <FooterLabel>{t('hbpViewAll', { title })}</FooterLabel>
            <ArrowSquareOut size={14} />
          </Footer>
        </Panel>
      </Root>
    </ThemeProvider>
  );
});

const Root = styled.div`
  position: absolute;
  inset: 0;
  padding: 3px 16px 16px;
  box-sizing: border-box;
`;
const Panel = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  ${({ theme }: any) => `
    box-shadow: ${
      theme.dark
        ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
        : '0 1px 4px rgba(20, 32, 72, 0.05), 0 4px 12px rgba(20, 32, 72, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7)'
    };
    background-color: ${
      theme.dark ? 'rgba(15, 18, 24, 0.88)' : 'rgba(255, 255, 255, 0.72)'
    };
    color: ${theme['dialog.textColor']};
  `}
`;
const Header = styled.div`
  height: 46px;
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 14px 0 12px;
  font-size: 15px;
  font-weight: 650;
`;
const HeaderIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 10px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.12);
`;
const HeaderTitle = styled.div`
  flex: 1;
`;
const CloseButton = styled.button`
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: inherit;
  background: transparent;
  cursor: pointer;
  opacity: 0.58;
  transition: background-color 0.15s ease, opacity 0.15s ease,
    transform 0.15s ease;
  &:hover {
    opacity: 1;
    background: rgba(71, 114, 232, 0.14);
    transform: rotate(90deg);
  }
  &:active {
    transform: rotate(90deg) scale(0.9);
  }
`;
const SearchBox = styled.div`
  height: 40px;
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 12px 9px;
  padding: 0 11px;
  border: 1px solid rgba(120, 130, 150, 0.2);
  border-radius: 13px;
  color: ${({ theme }: any) =>
    theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
  background: ${({ theme }: any) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.11)'
      : 'rgba(240, 243, 249, 0.78)'};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    background 0.15s ease;
  &:focus-within {
    border-color: rgba(71, 114, 232, 0.55);
    background: ${({ theme }: any) =>
      theme['dialog.lightForeground']
        ? 'rgba(255, 255, 255, 0.16)'
        : 'rgba(255, 255, 255, 0.9)'};
    box-shadow: 0 0 0 3px rgba(71, 114, 232, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }
`;
const SearchIcon = styled.div`
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #4772e8;
  background: rgba(71, 114, 232, 0.12);
`;
const SearchInput = styled.input`
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0;
  &::placeholder {
    opacity: 0.5;
  }
`;
const List = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 12px 4px;
`;
const Row = styled.button<{ $level?: number }>`
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px 7px ${({ $level = 0 }) => 10 + $level * 18}px;
  margin-bottom: 2px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;
  &:hover {
    background: ${({ theme }: any) =>
      theme['dialog.lightForeground']
        ? 'rgba(104, 143, 236, 0.22)'
        : 'rgba(71, 114, 232, 0.09)'};
    transform: translateX(1px);
  }
`;
const RowIcon = styled.div`
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
`;
const RowText = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const RowTitle = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
`;
const RowSub = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 15px;
  opacity: 0.55;
`;
const Meta = styled.span`
  flex: 0 0 auto;
  font-size: 11px;
  opacity: 0.55;
`;
const sectionIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;
const ClosedSection = styled.section`
  margin: 0 0 4px;
`;
const SectionHeader = styled.div`
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 0 10px;
`;
const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 650;
  color: #4772e8;
`;
const SectionCount = styled.span`
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 8px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  background: rgba(71, 114, 232, 0.12);
`;
const SectionAction = styled.button`
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  color: #4772e8;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease;
  &:hover {
    background: rgba(71, 114, 232, 0.12);
  }
  &:focus-visible {
    outline: 2px solid rgba(71, 114, 232, 0.55);
    outline-offset: 1px;
  }
`;
const RestoreBadge = styled.span`
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  background: #4772e8;
  box-shadow: 0 2px 6px rgba(71, 114, 232, 0.35);
  transition: transform 0.12s ease;
`;
const ClosedMeta = styled.span`
  flex: 0 0 auto;
  font-size: 11px;
  opacity: 0.55;
`;
const ClosedRow = styled.button`
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 10px;
  margin-bottom: 2px;
  border-radius: 11px;
  border: 0;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: ${({ theme }: any) =>
    theme['dialog.lightForeground']
      ? 'rgba(104, 143, 236, 0.1)'
      : 'rgba(71, 114, 232, 0.05)'};
  animation: ${sectionIn} 0.22s ease both;
  transition: background-color 0.15s ease;
  &:hover,
  &:focus-visible {
    outline: 0;
    background: ${({ theme }: any) =>
      theme['dialog.lightForeground']
        ? 'rgba(104, 143, 236, 0.24)'
        : 'rgba(71, 114, 232, 0.12)'};
  }
  &:hover ${ClosedMeta}, &:focus-visible ${ClosedMeta} {
    display: none;
  }
  &:hover ${RestoreBadge}, &:focus-visible ${RestoreBadge} {
    display: flex;
  }
  &:active ${RestoreBadge} {
    transform: scale(0.9);
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
const ClosedIcon = styled.div`
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: ${({ theme }: any) =>
    theme['dialog.lightForeground']
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(255, 255, 255, 0.85)'};
  box-shadow: 0 0 0 1px rgba(120, 130, 150, 0.14);
  img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
`;
const MoreButton = styled.button`
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 9px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  opacity: 0.62;
  cursor: pointer;
  transition: background-color 0.15s ease, opacity 0.15s ease;
  &:hover {
    opacity: 1;
    background: rgba(71, 114, 232, 0.08);
  }
`;
const MoreCaret = styled.span<{ $open?: boolean }>`
  display: flex;
  transition: transform 0.2s ease;
  transform: rotate(${({ $open }) => ($open ? 180 : 0)}deg);
`;
const SectionDivider = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 4px 4px 10px;
  font-size: 12px;
  font-weight: 650;
  opacity: 0.55;
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(120, 130, 150, 0.22);
  }
`;
const Empty = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 12px;
  opacity: 0.55;
`;
const Footer = styled.button`
  height: 40px;
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(71, 114, 232, 0.22);
  margin: 5px 12px 11px;
  border-radius: 13px;
  color: ${({ theme }: any) =>
    theme['dialog.lightForeground'] ? '#fff' : '#161b2d'};
  background: ${({ theme }: any) =>
    theme['dialog.lightForeground']
      ? 'rgba(71,114,232,0.16)'
      : 'rgba(71,114,232,0.09)'};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
  transition: background 0.15s ease, border-color 0.15s ease,
    transform 0.15s ease;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  &:hover {
    background: ${({ theme }: any) =>
      theme['dialog.lightForeground']
        ? 'rgba(104,143,236,0.24)'
        : 'rgba(71,114,232,0.15)'};
    border-color: rgba(71, 114, 232, 0.38);
  }
  &:active {
    transform: scale(0.98);
  }
`;
const FooterLabel = styled.span`
  font-weight: 600;
`;

renderUI(App);
