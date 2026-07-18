import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';

import { StyledApp } from './style';
import store, { IPanelTab } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  SidebarHeader,
  SidebarHeaderActions,
  SidebarPinButton,
  SidebarBrand,
  SidebarBrandText,
  SidebarTabList,
  SidebarNewTab,
  SidebarNewTabLabel,
  SidebarGroupHeader,
  SidebarGroupDot,
  SidebarGroupName,
  SidebarGroupNameInput,
  SidebarGroupChevron,
  SidebarSwatches,
  SidebarSwatch,
} from '~/renderer/views/app/components/Sidebar/style';
import {
  StyledSidebarTab,
  SidebarTabIcon,
  SidebarTabPinBadge,
  SidebarTabTitle,
  SidebarTabClose,
  SidebarDropLine,
} from '~/renderer/views/app/components/SidebarTab/style';
import { getIconByUrlNet } from '~/utils/url';
import { getDraggedLinkURL, isLinkDragEvent } from '~/renderer/views/app/utils/link-drop';

const RainLogo = (
  <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
    <defs>
      <linearGradient id="rainpc-panel-logo" x1="7" y1="7" x2="57" y2="57" gradientUnits="userSpaceOnUse">
        <stop stopColor="#A07BFF" />
        <stop offset="0.55" stopColor="#7F98FF" />
        <stop offset="1" stopColor="#63B8FF" />
      </linearGradient>
    </defs>
    <path d="M40.5 12.5C26.6 12.5 16 22.3 16 35.2C16 45.1 23.3 52 33.5 52C36.8 52 39.5 49.4 39.5 46.2C39.5 43.7 38 42 35 40.8C28.7 38.2 25.5 34.6 25.5 29.6C25.5 23.2 31 18.8 38.9 18.8C44.4 18.8 49.1 20.8 52.8 24.3C53.8 21.9 54.3 19.3 54.3 16.5C50.5 13.9 45.7 12.5 40.5 12.5Z" fill="url(#rainpc-panel-logo)" />
    <path d="M49.5 9.2V17.2M45.5 13.2H53.5" stroke="#7D88FF" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

const ICON_PLUS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"></path>
  </svg>
);

const ChevronIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// 实心钉子 = 固定模式。浮层里点击即切回固定模式并收起浮层。
const PinIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 3.5l6 6-1 1-.9-.9-4.4 4.4.4 4-1 1-3.8-3.8-4.3 4.3-.7-.7 4.3-4.3-3.8-3.8 1-1 4 .4 4.4-4.4-.9-.9 1-1z" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="#5F6368" strokeWidth="1.6" />
    <path
      d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.4 3.5 8.5S14.3 18.1 12 20.5C9.7 18.1 8.5 15.1 8.5 12S9.7 5.9 12 3.5Z"
      stroke="#5F6368"
      strokeWidth="1.6"
    />
  </svg>
);

// 固定标签角标的钉子图标(与固定模式侧栏 SidebarTab 一致)。
const PinGlyph = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.95))' }}
  >
    <path d="M14.5 2.5l7 7-1.4 1.4-1-1-3.9 3.9.5 4.8-1.6 1.6-4.2-4.2-4.4 4.4-1.1-1.1 4.4-4.4-4.2-4.2 1.6-1.6 4.8.5 3.9-3.9-1-1 1.4-1.4z" />
  </svg>
);

const onListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (e.target === e.currentTarget) {
    store.clearLinkDrop();
  }
};

const onListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
    return;
  }
  store.clearLinkDrop();
};

const onListDrop = (e: React.DragEvent<HTMLDivElement>) => {
  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const url = getDraggedLinkURL(e.dataTransfer);
  store.clearLinkDrop();
  if (!url) return;
  store.action({ type: 'openLink', url });
};

const PanelTabRow = observer(({ tab }: { tab: IPanelTab }) => {
  const [iconFailed, setIconFailed] = React.useState(false);
  const prevUrlRef = React.useRef(tab.url);
  if (prevUrlRef.current !== tab.url) {
    setIconFailed(false);
    prevUrlRef.current = tab.url;
  }

  const iconSrc =
    tab.favicon ||
    (!iconFailed && tab.url ? getIconByUrlNet(tab.url) : undefined);
  const isDropTarget = store.linkDropTargetId === tab.id;

  return (
    <StyledSidebarTab
      selected={tab.selected}
      groupColor={tab.groupColor}
      onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
        if (!isLinkDragEvent(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        store.setLinkDropTarget(tab.id, e.clientY < r.top + r.height / 2);
      }}
      onDrop={(e: React.DragEvent<HTMLDivElement>) => {
        if (!isLinkDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        const url = getDraggedLinkURL(e.dataTransfer);
        store.clearLinkDrop();
        if (!url) return;
        store.action({ type: 'openLink', url, anchorTabId: tab.id, before });
      }}
      onMouseDown={(e: React.MouseEvent) => {
        if (e.button === 0) store.action({ type: 'select', tabId: tab.id });
        else if (e.button === 1) store.action({ type: 'close', tabId: tab.id });
      }}
      onContextMenu={() => store.action({ type: 'contextmenu', tabId: tab.id })}
    >
      {isDropTarget && (
        <SidebarDropLine
          position={store.linkDropBefore ? 'top' : 'bottom'}
        />
      )}
      <SidebarTabIcon>
        {iconSrc ? (
          <img
            src={iconSrc}
            width={16}
            height={16}
            draggable={false}
            style={{ display: 'block' }}
            onError={() => {
              if (!tab.favicon) setIconFailed(true);
            }}
          />
        ) : (
          <GlobeIcon />
        )}
        {tab.pinned && <SidebarTabPinBadge>{PinGlyph}</SidebarTabPinBadge>}
      </SidebarTabIcon>
      {/* 固定与否仅由 favicon 角标钉子区分,行体与普通标签一致(标题 + 关闭)。 */}
      <SidebarTabTitle selected={tab.selected}>{tab.title}</SidebarTabTitle>
      <SidebarTabClose
        visible
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          store.action({ type: 'close', tabId: tab.id });
        }}
      />
    </StyledSidebarTab>
  );
});

// 浮层内分组折叠头。与固定模式侧栏 SidebarGroupHeaderRow 行为一致:点色点改色、
// 双击组名改名——交互经 IPC 回传宿主执行。
const PanelGroupHeader = observer(
  ({
    gid,
    color,
    nameRaw,
    nameShown,
    collapsed,
  }: {
    gid: number;
    color?: string;
    nameRaw?: string;
    nameShown: string;
    collapsed: boolean;
  }) => {
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [name, setName] = React.useState(nameRaw || '');

    React.useEffect(() => {
      setName(nameRaw || '');
    }, [nameRaw, gid]);

    const commitName = () => {
      setEditing(false);
      store.action({ type: 'rename', groupId: gid, name: name.trim() });
    };

    return (
      <SidebarGroupHeader
        dropActive={store.linkDropGroupId === gid}
        onClick={() => {
          if (paletteOpen || editing) return;
          store.action({ type: 'toggleGroup', groupId: gid });
        }}
        onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
          if (!isLinkDragEvent(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          store.setLinkDropGroup(gid);
        }}
        onDrop={(e: React.DragEvent<HTMLDivElement>) => {
          if (!isLinkDragEvent(e)) return;
          e.preventDefault();
          e.stopPropagation();
          const url = getDraggedLinkURL(e.dataTransfer);
          store.clearLinkDrop();
          if (!url) return;
          store.action({ type: 'openLink', url, groupId: gid });
        }}
      >
        <SidebarGroupDot
          style={{ backgroundColor: color }}
          title="点击选择组色"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setPaletteOpen((v) => !v);
          }}
        />
        {paletteOpen && (
          <SidebarSwatches onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            {store.palette.map((c) => (
              <SidebarSwatch
                key={c}
                style={{ backgroundColor: c }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  store.action({ type: 'setcolor', groupId: gid, color: c });
                  setPaletteOpen(false);
                }}
              />
            ))}
          </SidebarSwatches>
        )}
        {editing ? (
          <SidebarGroupNameInput
            autoFocus
            value={name}
            placeholder={nameShown}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                setName(nameRaw || '');
                setEditing(false);
              }
            }}
          />
        ) : (
          <SidebarGroupName
            title="双击可重命名分组"
            onDoubleClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {nameShown}
          </SidebarGroupName>
        )}
        <SidebarGroupChevron collapsed={collapsed}>
          {ChevronIcon}
        </SidebarGroupChevron>
      </SidebarGroupHeader>
    );
  },
);

export const App = observer(() => {
  // 与固定模式一致地把标签铺开:分组连续段发一次组头 + 缩进的成员行。
  // 固定与否仅由 favicon 角标的钉子区分,行体与普通标签一致,不画分隔线。
  const items: React.ReactNode[] = [];
  let lastGroupId = -999;

  for (const tab of store.tabs) {
    const inGroup = tab.groupId !== -1 && tab.groupId != null;

    if (inGroup) {
      if (tab.groupId !== lastGroupId) {
        const gid = tab.groupId;
        const isCollapsed = !!store.groupsCollapsed[gid];
        items.push(
          <PanelGroupHeader
            key={`g${gid}`}
            gid={gid}
            color={tab.groupColor}
            nameRaw={tab.groupNameRaw}
            nameShown={tab.groupName || '分组'}
            collapsed={isCollapsed}
          />,
        );
        lastGroupId = gid;
      }
      if (!store.groupsCollapsed[tab.groupId]) {
        items.push(<PanelTabRow key={tab.id} tab={tab} />);
      }
    } else {
      lastGroupId = -1;
      items.push(<PanelTabRow key={tab.id} tab={tab} />);
    }
  }

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp
        key={store.showSeq}
        side={store.side}
        onMouseEnter={() => store.notifyEnter()}
        onMouseLeave={() => store.notifyLeave()}
      >
        <UIStyle />
        <SidebarHeader>
          <SidebarBrand>
            {RainLogo}
            <SidebarBrandText>雨见浏览器</SidebarBrandText>
          </SidebarBrand>
          <SidebarHeaderActions>
            <SidebarPinButton
              pinned
              title="缩放模式（点击切换为固定模式）"
              onMouseDown={(e: React.MouseEvent) => {
                e.stopPropagation();
                e.preventDefault();
                store.action({ type: 'setpinned', pinned: true });
              }}
            >
              {PinIcon}
            </SidebarPinButton>
          </SidebarHeaderActions>
        </SidebarHeader>

        <SidebarNewTab
          onMouseDown={() => store.action({ type: 'new' })}
          title="新建标签页"
        >
          {ICON_PLUS}
          <SidebarNewTabLabel>新建标签页</SidebarNewTabLabel>
        </SidebarNewTab>

        <SidebarTabList
          onDragOver={onListDragOver}
          onDragLeave={onListDragLeave}
          onDrop={onListDrop}
        >
          {items}
        </SidebarTabList>
      </StyledApp>
    </ThemeProvider>
  );
});
