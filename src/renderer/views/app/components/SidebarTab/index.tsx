import { observer } from 'mobx-react-lite';
import * as React from 'react';

import {
  StyledSidebarTab,
  SidebarTabIcon,
  SidebarTabPinBadge,
  SidebarTabTitle,
  SidebarTabClose,
  SidebarDropLine,
} from './style';
import { Preloader } from '~/renderer/components/Preloader';
import { ITab } from '../../models';
import store from '../../store';
import { handleTabContextMenu } from '../../utils/tab-context-menu';
import { getIconByUrlNet } from '~/utils/url';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';
import { useTabHoverActivation } from '~/renderer/utils/tab-hover-activation';

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

// 固定标签角标的钉子图标:currentColor 取主题强调色,白色描边保证可见性。
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

const onMouseDown = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button === 0 && !tab.isSelected) {
    tab.select();
  }
};

const onMouseUp = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button === 1) {
    tab.close();
  }
};

const onClose = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
  tab.close();
};

const onDoubleClick = (tab: ITab) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (store.settings.object.closeTabOnDoubleClick) {
    tab.close();
  }
};

const onCloseMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

// 拖拽重排:HTML5 draggable(与标签组悬停弹窗同一套稳妥方案,规避顶部 strip
// 那种基于绝对定位 + 全局 mousemove 的复杂度;侧栏是纯 flexbox 列表,drag 事件
// 天然够用)。落点按指针在行内上/下半判定插到目标前/后,松手由 store 完成重排。
const onDragStart = (tab: ITab) => (e: React.DragEvent<HTMLDivElement>) => {
  store.tabs.setSidebarDrag(tab.id);
  // 侧栏内部排序是 move，拖到书签栏收藏是 copy。
  e.dataTransfer.effectAllowed = 'copyMove';
  // Firefox 需要 setData 才会真正启动拖拽。
  try {
    e.dataTransfer.setData('text/plain', String(tab.id));
  } catch (err) {
    /* 忽略:某些环境禁止写 dataTransfer */
  }
};

const onDragOver = (tab: ITab) => (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragGroupId !== -1) {
    const group = store.tabGroups.getGroupById(store.tabs.sidebarDragGroupId);
    if (
      !group ||
      tab.tabGroupId === group.id ||
      group.isPinned !== store.tabs.isTabInPinnedZone(tab) ||
      (group.isPinned && tab.isPinned)
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    store.tabs.setSidebarDropTarget(tab.id, e.clientY < r.top + r.height / 2);
    return;
  }

  if (store.tabs.sidebarDragId !== -1) {
    if (store.tabs.sidebarDragId === tab.id) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    store.tabs.setSidebarDropTarget(tab.id, before);
    return;
  }

  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const before = e.clientY < r.top + r.height / 2;
  store.tabs.setSidebarDropTarget(tab.id, before);
};

const onDrop = (tab: ITab) => (e: React.DragEvent<HTMLDivElement>) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const before = e.clientY < r.top + r.height / 2;

  if (store.tabs.sidebarDragGroupId !== -1) {
    e.preventDefault();
    e.stopPropagation();
    const group = store.tabGroups.getGroupById(store.tabs.sidebarDragGroupId);
    store.tabs.clearSidebarGroupDrag();
    if (group) store.tabs.moveGroupNextToTabInSidebar(group, tab, before);
    return;
  }

  if (store.tabs.sidebarDragId !== -1) {
    e.preventDefault();
    e.stopPropagation();
    const fromId = store.tabs.sidebarDragId;
    store.tabs.clearSidebarDrag();
    if (fromId === -1 || fromId === tab.id) return;
    const from = store.tabs.getTabById(fromId);
    if (from) store.tabs.moveTabInSidebar(from, tab, before);
    return;
  }

  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const url = getDraggedLinkURL(e.dataTransfer);
  store.tabs.clearSidebarDropTarget();
  if (!url) return;
  store.tabs.openLinkInSidebarNearTab(url, tab, before);
};

const onDragEnd = () => {
  store.tabs.clearSidebarDrag();
};

export const SidebarTab = observer(
  ({
    tab,
    groupColor,
    collapsed,
    pinned,
  }: {
    tab: ITab;
    groupColor?: string;
    collapsed?: boolean;
    pinned?: boolean;
  }) => {
    const tabRef = React.useRef<HTMLDivElement>(null);
    const [failedIconSources, setFailedIconSources] = React.useState<string[]>(
      [],
    );
    const prevUrlRef = React.useRef(tab.url);
    if (prevUrlRef.current !== tab.url) {
      setFailedIconSources([]);
      prevUrlRef.current = tab.url;
    }

    React.useLayoutEffect(() => {
      if (!tab.isSelected) return;

      tabRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }, [tab.isSelected]);

    const hoverActivation = useTabHoverActivation({
      enabled:
        store.settings.object.tabHoverActivationBehavior !== 'off' &&
        (tab.discarded ||
          store.settings.object.tabHoverActivationBehavior ===
            'activate-and-switch'),
      delay: store.settings.object.tabHoverActivationDelay,
      selected: tab.isSelected,
      activate: () =>
        tab.activateOnHover(
          store.settings.object.tabHoverActivationBehavior ===
            'activate-and-switch',
        ),
      blocked: () =>
        store.tabs.sidebarDragId !== -1 || store.tabs.sidebarDragGroupId !== -1,
    });

    // 关闭中的标签仍需先走完同一套 Hook，避免双击关闭时触发 Hook 数量不一致。
    if (tab.isClosing) return null;

    const isDragging =
      store.tabs.sidebarDragId !== -1 && store.tabs.sidebarDragId === tab.id;
    const isDropTarget =
      store.tabs.sidebarDropTargetId !== -1 &&
      store.tabs.sidebarDropTargetId === tab.id;
    const dropBefore = store.tabs.sidebarDropBefore;
    const fallbackIconSrc = tab.url ? getIconByUrlNet(tab.url) : undefined;
    const iconSrc = [tab.favicon, fallbackIconSrc].find(
      (src) => src && !failedIconSources.includes(src),
    );

    return (
      <StyledSidebarTab
        ref={tabRef}
        data-rainsee-part="sidebar-tab"
        data-rainsee-selected={tab.isSelected ? 'true' : 'false'}
        data-rainsee-pinned={pinned ? 'true' : 'false'}
        data-sidebar-drop-owner="true"
        selected={tab.isSelected}
        groupColor={groupColor}
        collapsed={collapsed}
        dragging={isDragging}
        draggable
        title={collapsed ? tab.displayTitle : undefined}
        onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
          hoverActivation.cancel();
          onDragStart(tab)(e);
        }}
        onDragOver={onDragOver(tab)}
        onDrop={onDrop(tab)}
        onDragEnd={onDragEnd}
        onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
          hoverActivation.cancel();
          onMouseDown(tab)(e);
        }}
        onMouseUp={onMouseUp(tab)}
        onDoubleClick={onDoubleClick(tab)}
        onContextMenu={(e: React.MouseEvent) => handleTabContextMenu(e, tab)}
        onMouseEnter={() => {
          store.tabs.hoveredTabId = tab.id;
          hoverActivation.schedule();
        }}
        onMouseLeave={() => {
          store.tabs.hoveredTabId = -1;
          hoverActivation.cancel();
        }}
      >
        {isDropTarget && (
          <SidebarDropLine position={dropBefore ? 'top' : 'bottom'} />
        )}
        {tab.loading ? (
          <Preloader
            color={store.theme.accentColor}
            thickness={6}
            size={16}
            indeterminate
            style={{ minWidth: 16 }}
          />
        ) : (
          <SidebarTabIcon data-rainsee-part="sidebar-tab-icon">
            {iconSrc ? (
              <img
                src={iconSrc}
                width={16}
                height={16}
                draggable={false}
                style={{ display: 'block' }}
                onError={() => {
                  setFailedIconSources((sources) =>
                    sources.includes(iconSrc) ? sources : [...sources, iconSrc],
                  );
                }}
              />
            ) : (
              <GlobeIcon />
            )}
            {pinned && <SidebarTabPinBadge>{PinGlyph}</SidebarTabPinBadge>}
          </SidebarTabIcon>
        )}
        {/* 固定与否仅由 favicon 角标钉子区分,行体与普通标签完全一致(标题 + 悬停关闭)。 */}
        {!collapsed && (
          <>
            <SidebarTabTitle
              data-rainsee-part="sidebar-tab-title"
              selected={tab.isSelected}
            >
              {tab.displayTitle}
            </SidebarTabTitle>
            <SidebarTabClose
              data-rainsee-action="close-tab"
              visible={store.settings.object.tabCloseButtonDisplay !== 'never'}
              hoverOnly={
                store.settings.object.tabCloseButtonDisplay === 'hover'
              }
              onMouseEnter={hoverActivation.cancel}
              onMouseDown={onCloseMouseDown}
              onClick={onClose(tab)}
            />
          </>
        )}
      </StyledSidebarTab>
    );
  },
);
