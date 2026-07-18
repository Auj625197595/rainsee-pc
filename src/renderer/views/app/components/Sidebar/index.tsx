import { observer } from 'mobx-react-lite';
import * as React from 'react';

import {
  StyledSidebar,
  SidebarHeader,
  SidebarHeaderActions,
  SidebarPinButton,
  SidebarBrand,
  SidebarBrandText,
  SidebarTabList,
  SidebarNewTab,
  SidebarNewTabLabel,
} from './style';
import store from '../../store';
import { SidebarTab } from '../SidebarTab';
import { SidebarGroupHeaderRow } from './SidebarGroupHeaderRow';
import { LayoutSwitcher } from '../LayoutSwitcher';
import { RecentlyClosedTabs } from '../RecentlyClosedTabs';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';

const onNewTab = () => {
  store.tabs.addTab();
};

const onListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragId !== -1 || !isLinkDragEvent(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (e.target === e.currentTarget) {
    store.tabs.clearSidebarDropTarget();
  }
};

const onListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragId !== -1) return;
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
    return;
  }
  store.tabs.clearSidebarDropTarget();
};

const onListDrop = (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragId !== -1 || !isLinkDragEvent(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const url = getDraggedLinkURL(e.dataTransfer);
  store.tabs.clearSidebarDropTarget();
  if (!url) return;
  store.tabs.openLinkAt(url, store.tabs.list.length);
};

const RainLogo = (
  <svg width="22" height="22" viewBox="0 0 64 64" fill="none">
    <defs>
      <linearGradient id="rainpc-sidebar-logo" x1="7" y1="7" x2="57" y2="57" gradientUnits="userSpaceOnUse">
        <stop stopColor="#A07BFF" />
        <stop offset="0.55" stopColor="#7F98FF" />
        <stop offset="1" stopColor="#63B8FF" />
      </linearGradient>
    </defs>
    <path d="M40.5 12.5C26.6 12.5 16 22.3 16 35.2C16 45.1 23.3 52 33.5 52C36.8 52 39.5 49.4 39.5 46.2C39.5 43.7 38 42 35 40.8C28.7 38.2 25.5 34.6 25.5 29.6C25.5 23.2 31 18.8 38.9 18.8C44.4 18.8 49.1 20.8 52.8 24.3C53.8 21.9 54.3 19.3 54.3 16.5C50.5 13.9 45.7 12.5 40.5 12.5Z" fill="url(#rainpc-sidebar-logo)" />
    <path d="M49.5 9.2V17.2M45.5 13.2H53.5" stroke="#7D88FF" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

const ICON_PLUS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"></path>
  </svg>
);

// 钉子图标:实心=固定模式,空心(斜置)=缩放模式。
const PinIcon = (filled: boolean) =>
  filled ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14.5 2.5l7 7-1.4 1.4-1-1-3.9 3.9.5 4.8-1.6 1.6-4.2-4.2-4.4 4.4-1.1-1.1 4.4-4.4-4.2-4.2 1.6-1.6 4.8.5 3.9-3.9-1-1 1.4-1.4z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3.5l6 6-1 1-.9-.9-4.4 4.4.4 4-1 1-3.8-3.8-4.3 4.3-.7-.7 4.3-4.3-3.8-3.8 1-1 4 .4 4.4-4.4-.9-.9 1-1z" />
    </svg>
  );

export const Sidebar = observer(() => {
  const side = store.tabsLayout === 'right' ? 'right' : 'left';
  const pinned = store.settings.object.sidebarPinned !== false;
  // 窄轨态 = 缩放模式(固定模式恒为完整展开)。缩放模式下鼠标移入窄轨不再本地
  // 展开,而是弹出独立 BrowserView 浮层(浮于网页之上,见 tabs.openSidebarPanel)。
  const railCollapsed = !pinned;

  const togglePinned = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    store.settings.setSidebarPinned(!pinned);
    // 从缩放切到固定:确保浮层收起。
    if (!pinned) store.tabs.hideSidebarPanel();
  };

  // 缩放模式:鼠标移入窄轨弹浮层,移出计划收起(浮层自身 enter/leave 与之协同,
  // 指针在窄轨↔浮层间移动不闪断)。固定模式不介入。
  const onRailEnter = () => {
    if (railCollapsed) store.tabs.openSidebarPanel();
  };
  const onRailLeave = () => {
    if (railCollapsed) store.tabs.scheduleSidebarPanelHide();
  };

  // 各分组的折叠态(按组 id)。默认展开。
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>({});
  const toggle = (gid: number) =>
    setCollapsed((s) => ({ ...s, [gid]: !s[gid] }));

  // 侧栏是完整列表:非分组/固定标签原样渲染;每组渲染一个可折叠头 + 缩进的组色
  // tint 成员行。组在 list 中是连续的,用 lastGroupId 只在进入新组时发一次头。
  // 固定与否仅由 favicon 角标的钉子区分,固定标签的行体与普通标签完全一致,
  // 故不再在固定区与普通区之间画分隔线。
  const items: React.ReactNode[] = [];
  let lastGroupId = -999;

  for (const tab of store.tabs.list) {
    if (tab.isClosing) continue;
    const group = tab.tabGroupId !== -1 ? tab.tabGroup : undefined;

    if (group) {
      if (tab.tabGroupId !== lastGroupId) {
        const isCollapsed = !!collapsed[group.id];
        const gid = group.id;
        items.push(
          <SidebarGroupHeaderRow
            key={`g${gid}`}
            group={group}
            collapsed={isCollapsed}
            railCollapsed={railCollapsed}
            onToggle={() => toggle(gid)}
          />,
        );
        lastGroupId = tab.tabGroupId;
      }
      if (!collapsed[group.id]) {
        items.push(
          <SidebarTab
            key={tab.id}
            tab={tab}
            groupColor={group.color}
            collapsed={railCollapsed}
          />,
        );
      }
    } else {
      // 离开组:重置 lastGroupId,使后续(若有)同 id 组重新发头(组本应连续,
      // 此处仅作兜底)。
      lastGroupId = -1;
      items.push(
        <SidebarTab
          key={tab.id}
          tab={tab}
          pinned={tab.isPinned}
          collapsed={railCollapsed}
        />,
      );
    }
  }

  return (
    <StyledSidebar
      side={side}
      collapsed={railCollapsed}
      onMouseEnter={onRailEnter}
      onMouseLeave={onRailLeave}
    >
      <SidebarHeader>
        <SidebarBrand>
          {RainLogo}
          <SidebarBrandText collapsed={railCollapsed}>
            雨见浏览器
          </SidebarBrandText>
        </SidebarBrand>
        <SidebarHeaderActions collapsed={railCollapsed}>
          <LayoutSwitcher variant="bar" />
          <RecentlyClosedTabs variant="bar" />
          <SidebarPinButton
            pinned={pinned}
            title={pinned ? '固定模式（点击切换为缩放模式）' : '缩放模式（点击切换为固定模式）'}
            onMouseDown={togglePinned}
          >
            {PinIcon(pinned)}
          </SidebarPinButton>
        </SidebarHeaderActions>
      </SidebarHeader>

      <SidebarNewTab collapsed={railCollapsed} onMouseDown={onNewTab} title="新建标签页">
        {railCollapsed && ICON_PLUS}
        <SidebarNewTabLabel collapsed={railCollapsed}>
          新建标签页
        </SidebarNewTabLabel>
      </SidebarNewTab>

      <SidebarTabList
        onDragOver={onListDragOver}
        onDragLeave={onListDragLeave}
        onDrop={onListDrop}
      >
        {items}
      </SidebarTabList>
    </StyledSidebar>
  );
});
