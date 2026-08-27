import * as React from 'react';
import { clipboard, ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { observable, makeObservable, runInAction } from 'mobx';
import {
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
import { getIconByUrlNet } from '~/utils/url';
import { UIStyle } from '~/renderer/mixins/default-styles';
import styled from 'styled-components';
import { renderUI } from '~/utils/ui-entry';

type Kind = 'history' | 'bookmarks';

class Store extends DialogStore {
  public kind: Kind = 'history';

  public constructor() {
    super({ persistent: true, visibilityWrapper: false, hideOnBlur: false });
    makeObservable(this, { kind: observable });
    ipcRenderer.on(
      'visible',
      (_event, visible: boolean, data?: { kind?: Kind }) => {
        runInAction(() => {
          this.kind = data?.kind === 'bookmarks' ? 'bookmarks' : 'history';
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

  public openUrl(url: string, target: 'current' | 'new' | 'background' = 'current') {
    ipcRenderer.send(
      `history-bookmarks-popup-open-url-${this.windowId}`,
      url,
      target,
    );
    this.hide();
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

const ago = (date: number) => {
  const time = new Date(date).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  const d = new Date(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

type BookmarkTreeItem = IBookmark & { level: number };

const rootTitle = (item: IBookmark) => {
  switch (item.static) {
    case 'main':
      return '书签栏';
    case 'other':
      return '其他书签';
    case 'mobile':
      return '移动书签';
    default:
      return item.title || '书签';
  }
};

const bookmarkTree = (
  items: IBookmark[],
  expanded: Set<string>,
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
      title: level === 0 ? rootTitle(item) : item.title,
      level,
    });
    if (!item.isFolder || !item._id || !expanded.has(item._id)) return;
    (children.get(item._id) || []).forEach((child) => visit(child, level + 1));
  };
  roots.forEach((root) => visit(root, 0));
  return result;
};

const App = observer(() => {
  const [history, setHistory] = React.useState<IHistoryItem[]>([]);
  const [bookmarks, setBookmarks] = React.useState<IBookmark[]>([]);
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = React.useState('');
  const [engaged, setEngaged] = React.useState(false);
  const engageTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const engagedRef = React.useRef(false);
  const isHistory = store.kind === 'history';

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

  const toggleFolder = (id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          label: expandedFolders.has(folder._id || '') ? '收起文件夹' : '展开文件夹',
          click: () => folder._id && toggleFolder(folder._id),
        });
      } else if (url) {
        menuItems.push(
          {
            label: '在当前页打开',
            click: () => store.openUrl(url),
          },
          {
            label: '在新标签页打开',
            click: () => store.openUrl(url, 'new'),
          },
          {
            label: '在新标签页打开（不切换）',
            click: () => store.openUrl(url, 'background'),
          },
          { type: 'separator' },
          {
            label: '复制链接地址',
            click: () => clipboard.writeText(url),
          },
        );
      }
      const canDelete = isHistory || !('static' in item && item.static);
      if (item._id && canDelete) {
        menuItems.push(
          { type: 'separator' },
          {
            label: '删除',
            click: () => removeItem(item),
          },
        );
      }
      if (menuItems.length) remote.Menu.buildFromTemplate(menuItems).popup();
    },
    [clearEngageTimer, expandedFolders, isHistory, removeItem, toggleFolder],
  );

  React.useEffect(() => {
    if (store.visible) return;
    clearEngageTimer();
    engagedRef.current = false;
    setEngaged(false);
  }, [clearEngageTimer, store.visible]);

  React.useEffect(() => {
    clearEngageTimer();
    engagedRef.current = false;
    setEngaged(false);
  }, [clearEngageTimer, store.kind]);

  React.useEffect(() => () => clearEngageTimer(), [clearEngageTimer]);
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
              setBookmarks(Array.isArray(items) ? items : []);
              setExpandedFolders(new Set());
            }
          });
    void task.finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [store.visible, store.kind]);

  const visibleBookmarks = React.useMemo(
    () => bookmarkTree(bookmarks, expandedFolders),
    [bookmarks, expandedFolders],
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
    return bookmarkTree(bookmarks, allExpanded).filter((item) =>
      [item.title, item.url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [bookmarks, normalizedQuery, visibleBookmarks]);
  const items = isHistory ? filteredHistory : filteredBookmarks;
  const title = isHistory ? '历史记录' : '收藏夹';

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
                title="关闭"
                aria-label="关闭"
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
              placeholder={isHistory ? '搜索历史记录' : '搜索书签'}
              spellCheck={false}
            />
          </SearchBox>
          <List>
            {loading ? (
              <Empty>正在加载…</Empty>
            ) : !items.length ? (
              <Empty>{isHistory ? '暂无历史记录' : '暂无书签'}</Empty>
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
                  <Meta>{ago(item.date || 0)}</Meta>
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
            <FooterLabel>查看全部{title}</FooterLabel>
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
