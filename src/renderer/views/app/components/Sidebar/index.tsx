import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { clipboard, ipcRenderer } from 'electron';
import { platform } from 'os';

import {
  StyledSidebar,
  SidebarHeader,
  SidebarHeaderActions,
  SidebarPinButton,
  SidebarBrand,
  SidebarBrandText,
  SidebarWorkspaceDot,
  SidebarHoverArea,
  SidebarTabList,
  SidebarNewTab,
  SidebarNewTabLabel,
  SidebarGroupSection,
} from './style';
import store from '../../store';
import { SidebarTab } from '../SidebarTab';
import { SidebarGroupHeaderRow } from './SidebarGroupHeaderRow';
import { LayoutSwitcher } from '../LayoutSwitcher';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';
import { buildGroupSlots } from '../../utils/group-slots';
// 开源版：互联状态模块已移除。
import { useWindowDragMove } from '../../utils/window-drag';
import { ProfileBrandLogo, useProfileBrand } from '../ProfileBrandLogo';
import { isURL, realurl } from '~/utils';
import { getExternalProtocol } from '~/utils/url';
import { useActionBubble } from '../../utils/action-bubble';
import {
  createTabWheelHandler,
  getTabScrollStep,
} from '../../utils/tab-wheel-switch';

const sidebarListRef = React.createRef<HTMLDivElement>();

const sidebarWheelHandler = createTabWheelHandler({
  axis: 'vertical',
  getBehavior: () => store.settings.object.tabWheelBehavior || 'auto',
  getContainer: () => sidebarListRef.current,
  onSwitch: (direction) => store.tabs.switchAdjacentTab(direction),
  onSwitched: (direction, behavior) => {
    window.requestAnimationFrame(() => {
      const container = sidebarListRef.current;
      const selected = container?.querySelector<HTMLElement>(
        '[data-rainsee-selected="true"]',
      );
      if (!container) return;
      if (behavior === 'always-switch') {
        container.scrollTop +=
          direction * getTabScrollStep(selected, 'vertical', 42);
      }
      selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
});

const onNewTab = (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button !== 0) return;
  store.tabs.addTab();
};

const onListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragGroupId !== -1) {
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (dropOwner) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    store.tabs.setSidebarDropOutside();
    return;
  }

  if (store.tabs.sidebarDragId !== -1) {
    const dragTab = store.tabs.getTabById(store.tabs.sidebarDragId);
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (!dragTab || dragTab.tabGroupId === -1 || dropOwner) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    store.tabs.setSidebarDropOutside();
    return;
  }

  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (e.target === e.currentTarget) {
    store.tabs.clearSidebarDropTarget();
  }
};

const onListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
    return;
  }
  store.tabs.clearSidebarDropTarget();
};

const onListDrop = (e: React.DragEvent<HTMLDivElement>) => {
  if (store.tabs.sidebarDragGroupId !== -1) {
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (dropOwner) return;

    e.preventDefault();
    e.stopPropagation();
    const group = store.tabGroups.getGroupById(store.tabs.sidebarDragGroupId);
    store.tabs.clearSidebarGroupDrag();
    if (group) store.tabs.moveGroupToSidebarEnd(group);
    return;
  }

  if (store.tabs.sidebarDragId !== -1) {
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (dropOwner) return;

    e.preventDefault();
    e.stopPropagation();
    const dragTab = store.tabs.getTabById(store.tabs.sidebarDragId);
    store.tabs.clearSidebarDrag();
    if (dragTab && dragTab.tabGroupId !== -1) {
      store.tabs.moveTabOutOfGroupInSidebar(dragTab);
    }
    return;
  }

  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const url = getDraggedLinkURL(e.dataTransfer);
  store.tabs.clearSidebarDropTarget();
  if (!url) return;
  store.tabs.openLinkAt(url, store.tabs.list.length);
};

const APP_ICON = require('!!file-loader?esModule=false&outputPath=res!../../../../../../static/icons/icon2.png');

const ICON_PLUS = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
  >
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 3.5l6 6-1 1-.9-.9-4.4 4.4.4 4-1 1-3.8-3.8-4.3 4.3-.7-.7 4.3-4.3-3.8-3.8 1-1 4 .4 4.4-4.4-.9-.9 1-1z" />
    </svg>
  );

const SidebarBrandMark = observer(({ collapsed }: { collapsed: boolean }) => {
  const profileBrand = useProfileBrand();
  const workspace = store.workspaceContext;

  // 品牌区同时是窗口拖拽热区
  const { onMouseDown: onDragMouseDown, onClick: onDragClick } =
    useWindowDragMove(() => {});

  return (
    <SidebarBrand
      data-rainsee-part="sidebar-brand"
      collapsed={collapsed}
      $macLeft={platform() === 'darwin' && store.tabsLayout === 'left'}
      onMouseDown={onDragMouseDown}
      onClick={onDragClick}
    >
      <ProfileBrandLogo
        profileName={profileBrand.profileName}
        logoDataUrl={profileBrand.logoDataUrl}
        appIcon={APP_ICON}
        onSelect={profileBrand.selectLogo}
      />
      <SidebarBrandText
        data-rainsee-part="sidebar-brand-title"
        collapsed={collapsed}
        $macLeft={platform() === 'darwin' && store.tabsLayout === 'left'}
      >
        {workspace && <SidebarWorkspaceDot color={workspace.color} />}
        {workspace?.name || profileBrand.profileName || '雨见浏览器'}
      </SidebarBrandText>
    </SidebarBrand>
  );
});

export const Sidebar = observer(() => {
  const { show: showBubble, portal: bubblePortal } = useActionBubble();
  const side = store.tabsLayout === 'right' ? 'right' : 'left';
  const pinned = store.settings.object.sidebarPinned !== false;
  // 窄轨态 = 缩放模式(固定模式恒为完整展开)。缩放模式下鼠标移入窄轨不再本地
  // 展开,而是弹出独立 BrowserView 浮层(浮于网页之上,见 tabs.openSidebarPanel)。
  const railCollapsed = !pinned;

  React.useEffect(() => {
    const container = sidebarListRef.current;
    if (!container) return undefined;
    const onWheel = (event: WheelEvent) => {
      const result = sidebarWheelHandler(event);
      if (result.handled) event.preventDefault();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => {
    store.tabs.refreshSidebarPanel();
  }, [
    store.settings.object.tabWheelBehavior,
    store.settings.object.tabHoverActivationBehavior,
    store.settings.object.tabHoverActivationDelay,
  ]);

  const togglePinned = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    store.settings.setSidebarPinned(!pinned);
    // 从缩放切到固定:确保浮层收起。
    if (!pinned) store.tabs.hideSidebarPanel();
  };

  // 缩放模式:只有 Logo 下方区域会弹出完整侧栏;Logo 自身仍只负责互联面板。
  // 移出下方区域后计划收起,浮层自身的 enter/leave 会协同取消或恢复计时。
  const onRailEnter = () => {
    if (railCollapsed) store.tabs.openSidebarPanel();
  };
  const onRailLeave = () => {
    if (railCollapsed) store.tabs.scheduleSidebarPanelHide();
  };

  // 右键「新建标签页」按钮时，与顶部标签栏保持一致：网址直接打开，文本使用默认搜索引擎搜索。
  const onNewTabContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const raw = (clipboard.readText() || '').trim();
    if (raw === '') {
      showBubble('剪贴板没有内容', e.currentTarget, 'top');
      return;
    }

    const url = realurl(raw, store.settings.searchEngine.url);
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      showBubble('已在系统中打开链接', e.currentTarget, 'top');
      return;
    }

    store.tabs.addTab({ url, active: true });
    showBubble(
      isURL(raw) ? '已打开剪贴板网址' : '已搜索剪贴板',
      e.currentTarget,
      'top',
    );
  };

  // 各分组的折叠态(按组 id)。默认展开。
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>({});
  const toggle = (gid: number) =>
    setCollapsed((s) => ({ ...s, [gid]: !s[gid] }));

  // 侧栏是完整列表:散落/固定标签原样渲染;每个分组渲染一个可折叠头 + 缩进的
  // 组色 tint 成员行。分组按 buildGroupSlots 聚拢成连续块——不依赖「组成员在 list
  // 中连续」这一非硬不变量(拖拽/关闭/会话恢复/水合竞争都可能把同组成员拆散),
  // 否则同组被拆成几段就会发几个组头并因相同 React key 互相覆盖,表现为「展开/收起
  // 复制出几个分组」。固定与否仅由 favicon 角标的钉子区分,行体与普通标签完全一致,
  // 故不再在固定区与普通区之间画分隔线。
  const items: React.ReactNode[] = [];
  const slots = buildGroupSlots(
    store.tabs.list.filter((t) => !t.isClosing),
    (t) => (t.isPinned ? -1 : t.tabGroupId),
  );

  for (const slot of slots) {
    if (slot.kind === 'tab') {
      const tab = slot.item;
      items.push(
        <SidebarTab
          key={tab.id}
          tab={tab}
          pinned={tab.isPinned}
          collapsed={railCollapsed}
        />,
      );
      continue;
    }

    // 分组块:由首个成员解析出组对象;水合未就绪(group 为 undefined)时退化为
    // 不带头部的纯成员行(与 getSlots 兜底一致),下一帧组记录就绪后自然带上头部。
    const gid = slot.groupId;
    const group = slot.items[0]?.tabGroup;
    const isCollapsed = !!collapsed[gid];

    if (!group) {
      for (const tab of slot.items) {
        items.push(
          <SidebarTab key={tab.id} tab={tab} collapsed={railCollapsed} />,
        );
      }
      continue;
    }

    items.push(
      <SidebarGroupSection
        data-rainsee-part="sidebar-group-section"
        key={`g${gid}`}
        $groupColor={group.color}
        $groupCollapsed={isCollapsed}
        $railCollapsed={railCollapsed}
        $groupPinned={group.isPinned}
      >
        <SidebarGroupHeaderRow
          group={group}
          collapsed={isCollapsed}
          railCollapsed={railCollapsed}
          onToggle={() => toggle(gid)}
        />
        {!isCollapsed &&
          slot.items.map((tab) => (
            <SidebarTab
              key={tab.id}
              tab={tab}
              groupColor={group.color}
              collapsed={railCollapsed}
            />
          ))}
      </SidebarGroupSection>,
    );
  }

  return (
    <StyledSidebar
      data-rainsee-area="sidebar"
      side={side}
      collapsed={railCollapsed}
    >
      <SidebarHeader
        data-rainsee-part="sidebar-header"
        $macLeft={platform() === 'darwin' && side === 'left'}
      >
        <SidebarBrandMark collapsed={railCollapsed} />
        <SidebarHeaderActions collapsed={railCollapsed}>
          <LayoutSwitcher variant="bar" />
          <SidebarPinButton
            data-rainsee-part="toolbar-button"
            data-rainsee-action="sidebar-pin"
            pinned={pinned}
            title={
              pinned
                ? '固定模式（点击切换为缩放模式）'
                : '缩放模式（点击切换为固定模式）'
            }
            onMouseDown={togglePinned}
          >
            {PinIcon(pinned)}
          </SidebarPinButton>
        </SidebarHeaderActions>
      </SidebarHeader>

      <SidebarHoverArea onMouseEnter={onRailEnter} onMouseLeave={onRailLeave}>
        <SidebarNewTab
          data-rainsee-part="sidebar-new-tab"
          data-rainsee-action="new-tab"
          collapsed={railCollapsed}
          onMouseDown={onNewTab}
          onContextMenu={onNewTabContextMenu}
          title="新建标签页"
        >
          {railCollapsed && ICON_PLUS}
          <SidebarNewTabLabel collapsed={railCollapsed}>
            新建标签页
          </SidebarNewTabLabel>
        </SidebarNewTab>

        <SidebarTabList
          ref={sidebarListRef}
          data-rainsee-part="sidebar-tabs"
          $dropOutside={store.tabs.sidebarDropOutside}
          onDragOver={onListDragOver}
          onDragLeave={onListDragLeave}
          onDrop={onListDrop}
        >
          {items}
        </SidebarTabList>
      </SidebarHoverArea>
      {bubblePortal}
    </StyledSidebar>
  );
});
