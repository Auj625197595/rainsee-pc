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
  SidebarTabScroll,
  SidebarPinnedSection,
  SidebarRegularSection,
  SidebarPinnedHeader,
  SidebarPinnedHeaderIcon,
  SidebarPinnedCount,
  SidebarSectionDivider,
  SidebarNewTab,
  SidebarNewTabLabel,
  SidebarGroupSection,
} from './style';
import store from '../../store';
import { getShellTranslator } from '../../utils/i18n';
import { SidebarTab } from '../SidebarTab';
import { SidebarGroupHeaderRow } from './SidebarGroupHeaderRow';
import { LayoutSwitcher } from '../LayoutSwitcher';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';
import { buildGroupSlots } from '../../utils/group-slots';
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

const createSidebarWheelHandler = (getContainer: () => HTMLElement | null) =>
  createTabWheelHandler({
    axis: 'vertical',
    getBehavior: () => store.settings.object.tabWheelBehavior || 'auto',
    getContainer,
    onSwitch: (direction) => store.tabs.switchAdjacentTab(direction),
    onSwitched: (direction, behavior) => {
      window.requestAnimationFrame(() => {
        const container = getContainer();
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

const pinnedScrollRef = React.createRef<HTMLDivElement>();
const regularScrollRef = React.createRef<HTMLDivElement>();
const pinnedWheelHandler = createSidebarWheelHandler(() => pinnedScrollRef.current);
const regularWheelHandler = createSidebarWheelHandler(() => regularScrollRef.current);

const onNewTab = (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button !== 0) return;
  store.tabs.addTab();
};

const onListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  const zone =
    e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-sidebar-zone]')?.dataset.sidebarZone
      : undefined;

  if (store.tabs.sidebarDragGroupId !== -1) {
    const group = store.tabGroups.getGroupById(store.tabs.sidebarDragGroupId);
    if (group && zone && (zone === 'pinned') !== group.isPinned) return;
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
    if (dragTab && zone && (zone === 'pinned') !== store.tabs.isTabInPinnedZone(dragTab)) {
      return;
    }
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
  const zone =
    e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-sidebar-zone]')?.dataset.sidebarZone
      : undefined;

  if (store.tabs.sidebarDragGroupId !== -1) {
    const group = store.tabGroups.getGroupById(store.tabs.sidebarDragGroupId);
    if (group && zone && (zone === 'pinned') !== group.isPinned) return;
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (dropOwner) return;

    e.preventDefault();
    e.stopPropagation();
    store.tabs.clearSidebarGroupDrag();
    if (group) store.tabs.moveGroupToSidebarEnd(group);
    return;
  }

  if (store.tabs.sidebarDragId !== -1) {
    const dragTab = store.tabs.getTabById(store.tabs.sidebarDragId);
    if (dragTab && zone && (zone === 'pinned') !== store.tabs.isTabInPinnedZone(dragTab)) {
      return;
    }
    const dropOwner =
      e.target instanceof Element &&
      e.target.closest('[data-sidebar-drop-owner="true"]');
    if (dropOwner) return;

    e.preventDefault();
    e.stopPropagation();
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
  const brandRef = React.useRef<HTMLDivElement>(null);
  const profileBrand = useProfileBrand();
  const workspace = store.workspaceContext;
  const { onMouseDown: onDragMouseDown, onClick: onDragClick } =
    useWindowDragMove();

  const onMouseDown = (e: React.MouseEvent) => {
    onDragMouseDown(e);
  };

  return (
    <SidebarBrand
      data-rainsee-part="sidebar-brand"
      collapsed={collapsed}
      $macLeft={platform() === 'darwin' && store.tabsLayout === 'left'}
      ref={brandRef}
      onMouseLeave={clearOpenTimer}
      onMouseDown={onMouseDown}
      onClick={onDragClick}
    >
      <ProfileBrandLogo
        profileName={profileBrand.profileName}
        logoDataUrl={profileBrand.logoDataUrl}
        appIcon={APP_ICON}
        onInteractStart={clearOpenTimer}
        onSelect={profileBrand.selectLogo}
      />
      <SidebarBrandText
        data-rainsee-part="sidebar-brand-title"
        collapsed={collapsed}
        $macLeft={platform() === 'darwin' && store.tabsLayout === 'left'}
      >
        {workspace && <SidebarWorkspaceDot color={workspace.color} />}
        {workspace?.name || profileBrand.profileName || getShellTranslator()('aboutTitle')}
      </SidebarBrandText>
    </SidebarBrand>
  );
});

export const Sidebar = observer(() => {
  const t = getShellTranslator();
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
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-sidebar-scroll]')
        : null;
      const handler = target?.dataset.sidebarPinned === 'true'
        ? pinnedWheelHandler
        : regularWheelHandler;
      const result = handler(event);
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
  // 右侧窄轨紧贴网页竖向滚动条:滚轮/拖滚动条时指针稍微越界就会误弹。右侧改为
  // 「停留意图」触发:静止停留 RIGHT_RAIL_DWELL_MS 才弹出;按住按键(拖滚动条越界)
  // 不计时,窄轨内滚轮重新计时。左侧保持即时弹出。
  const RIGHT_RAIL_DWELL_MS = 320;
  const railOpenTimer = React.useRef<number | null>(null);
  const clearRailOpenTimer = () => {
    if (railOpenTimer.current != null) {
      window.clearTimeout(railOpenTimer.current);
      railOpenTimer.current = null;
    }
  };
  React.useEffect(() => clearRailOpenTimer, []);

  const startRailOpenTimer = () => {
    clearRailOpenTimer();
    railOpenTimer.current = window.setTimeout(() => {
      railOpenTimer.current = null;
      store.tabs.openSidebarPanel();
    }, RIGHT_RAIL_DWELL_MS);
  };

  const onRailEnter = (e: React.MouseEvent) => {
    if (!railCollapsed) return;
    if (side === 'left' || store.tabs.panelVisible) {
      store.tabs.openSidebarPanel();
      return;
    }
    store.tabs.cancelSidebarPanelHide();
    if (e.buttons === 0) startRailOpenTimer();
  };
  const onRailMove = (e: React.MouseEvent) => {
    if (!railCollapsed || side !== 'right' || store.tabs.panelVisible) return;
    if (e.buttons !== 0) {
      clearRailOpenTimer();
    } else if (railOpenTimer.current == null) {
      startRailOpenTimer();
    }
  };
  const onRailWheel = () => {
    if (!railCollapsed || side !== 'right' || store.tabs.panelVisible) return;
    if (railOpenTimer.current != null) startRailOpenTimer();
  };
  const onRailLeave = () => {
    clearRailOpenTimer();
    if (railCollapsed) store.tabs.scheduleSidebarPanelHide();
  };

  // 右键「新建标签页」按钮时，与顶部标签栏保持一致：网址直接打开，文本使用默认搜索引擎搜索。
  const onNewTabContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const raw = (clipboard.readText() || '').trim();
    if (raw === '') {
      showBubble(t('shellClipboardEmpty'), e.currentTarget, 'top');
      return;
    }

    const url = realurl(raw, store.settings.searchEngine.url);
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      showBubble(t('shellOpenedExternal'), e.currentTarget, 'top');
      return;
    }

    store.tabs.addTab({ url, active: true });
    showBubble(
      isURL(raw) ? t('shellOpenedClipboardUrl') : t('shellSearchedClipboard'),
      e.currentTarget,
      'top',
    );
  };

  // 各分组的折叠态(按组 id)。默认展开。
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>({});
  const toggle = (gid: number) =>
    setCollapsed((s) => ({ ...s, [gid]: !s[gid] }));

  // 侧栏分组按 buildGroupSlots 聚拢成连续块,再按固定区/普通区分流渲染。
  const slots = buildGroupSlots(
    store.tabs.list.filter((t) => !t.isClosing),
    (t) => (t.isPinned ? -1 : t.tabGroupId),
  );

  const isPinnedSlot = (slot: (typeof slots)[number]) =>
    slot.kind === 'tab'
      ? slot.item.isPinned
      : slot.items.some((tab) => store.tabs.isTabInPinnedZone(tab));
  const pinnedSlots = slots.filter(isPinnedSlot);
  const regularSlots = slots.filter((slot) => !isPinnedSlot(slot));
  const pinnedCount = store.tabs.list.filter(
    (tab) => !tab.isClosing && store.tabs.isTabInPinnedZone(tab),
  ).length;

  const renderSlots = (slotList: typeof slots) => {
    const items: React.ReactNode[] = [];
    for (const slot of slotList) {
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
    return items;
  };

  const hasPinned = pinnedSlots.length > 0;
  const [listHeight, setListHeight] = React.useState(0);
  const [resizing, setResizing] = React.useState(false);
  const [pinnedCollapsed, setPinnedCollapsed] = React.useState(false);
  const ratioSetting = store.settings.object.sidebarPinnedSectionRatio;
  const savedRatio =
    side === 'right' ? ratioSetting?.right : ratioSetting?.left;
  const [pinnedRatio, setPinnedRatio] = React.useState(savedRatio || 0.32);
  const pinnedRatioRef = React.useRef(pinnedRatio);

  React.useEffect(() => {
    const next = savedRatio || 0.32;
    pinnedRatioRef.current = next;
    setPinnedRatio(next);
  }, [side, savedRatio]);

  React.useLayoutEffect(() => {
    const element = sidebarListRef.current;
    if (!element) return undefined;
    const update = () => setListHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dividerHeight = 7;
  const minRegularHeight = 168;
  const usableHeight = Math.max(0, listHeight - dividerHeight);
  const maxPinnedHeight = Math.max(
    64,
    Math.min(280, usableHeight - minRegularHeight),
  );
  const minPinnedHeight = Math.min(90, maxPinnedHeight);
  const contentHeight = 30 + pinnedCount * 42 + 8;
  const desiredPinnedHeight = pinnedCount <= 2
    ? contentHeight
    : usableHeight * Math.max(0.12, Math.min(0.72, pinnedRatio));
  const pinnedHeight = Math.max(
    minPinnedHeight,
    Math.min(maxPinnedHeight, desiredPinnedHeight || minPinnedHeight),
  );

  const visiblePinnedHeight = pinnedCollapsed ? 30 : pinnedHeight;

  const setPinnedHeight = (height: number, persist: boolean) => {
    if (usableHeight <= 0) return;
    const nextHeight = Math.max(
      minPinnedHeight,
      Math.min(maxPinnedHeight, height),
    );
    const nextRatio = nextHeight / usableHeight;
    pinnedRatioRef.current = nextRatio;
    setPinnedRatio(nextRatio);
    if (persist) store.settings.setSidebarPinnedSectionRatio(side, nextRatio);
  };

  const resizeStart = React.useRef({ y: 0, height: 0 });
  const onDividerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !hasPinned) return;
    event.preventDefault();
    resizeStart.current = { y: event.clientY, height: pinnedHeight };
    setResizing(true);
  };

  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') {
      onDividerMouseDown(event as unknown as React.MouseEvent<HTMLDivElement>);
    }
  };

  React.useEffect(() => {
    if (!resizing) return undefined;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (event: MouseEvent | PointerEvent) => {
      setPinnedHeight(
        resizeStart.current.height + event.clientY - resizeStart.current.y,
        false,
      );
    };
    const onUp = () => {
      setResizing(false);
      if (usableHeight > 0) {
        store.settings.setSidebarPinnedSectionRatio(
          side,
          pinnedRatioRef.current,
        );
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing, side, usableHeight]);

  const onDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasPinned) return;
    const row = 42;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPinnedHeight(pinnedHeight + row, true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPinnedHeight(pinnedHeight - row, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPinnedHeight(minPinnedHeight, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPinnedHeight(maxPinnedHeight, true);
    }
  };

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
                ? t('shellPinMode')
                : t('shellCompactMode')
            }
            onMouseDown={togglePinned}
          >
            {PinIcon(pinned)}
          </SidebarPinButton>
        </SidebarHeaderActions>
      </SidebarHeader>

      <SidebarHoverArea
        onMouseEnter={onRailEnter}
        onMouseMove={onRailMove}
        onWheel={onRailWheel}
        onMouseLeave={onRailLeave}
      >
        <SidebarNewTab
          data-rainsee-part="sidebar-new-tab"
          data-rainsee-action="new-tab"
          collapsed={railCollapsed}
          onMouseDown={onNewTab}
          onContextMenu={onNewTabContextMenu}
          title={t('shellNewTab')}
        >
          {ICON_PLUS}
          <SidebarNewTabLabel collapsed={railCollapsed}>
            {t('shellNewTab')}
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
          {hasPinned && (
            <SidebarPinnedSection
              $height={visiblePinnedHeight}
              $collapsed={railCollapsed}
              $resizing={resizing}
            >
              <SidebarPinnedHeader
                $collapsed={railCollapsed}
                role="button"
                tabIndex={0}
                aria-expanded={!pinnedCollapsed}
                aria-label={t('shellPinnedTabs')}
                onClick={() => setPinnedCollapsed((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setPinnedCollapsed((value) => !value);
                  }
                }}
              >
                <SidebarPinnedHeaderIcon aria-hidden="true">
                  {PinIcon(true)}
                </SidebarPinnedHeaderIcon>
                {!railCollapsed && <span>{t('shellPinnedTabs')}</span>}
                {!railCollapsed && <SidebarPinnedCount>{pinnedCount}</SidebarPinnedCount>}
              </SidebarPinnedHeader>
              {!pinnedCollapsed && (
                <SidebarTabScroll
                  ref={pinnedScrollRef}
                  data-sidebar-scroll="true"
                  data-sidebar-pinned="true"
                  data-sidebar-zone="pinned"
                >
                  {renderSlots(pinnedSlots)}
                </SidebarTabScroll>
              )}
            </SidebarPinnedSection>
          )}
          {hasPinned && (
            <SidebarSectionDivider
              role="separator"
              tabIndex={0}
              aria-orientation="horizontal"
              aria-valuemin={12}
              aria-valuemax={72}
              aria-valuenow={Math.round((pinnedHeight / Math.max(1, usableHeight)) * 100)}
              $dragging={resizing}
              onMouseDown={onDividerMouseDown}
              onPointerDown={onDividerPointerDown}
              onKeyDown={onDividerKeyDown}
            />
          )}
          <SidebarRegularSection>
            <SidebarTabScroll
              ref={regularScrollRef}
              data-sidebar-scroll="true"
              data-sidebar-pinned="false"
              data-sidebar-zone="regular"
            >
              {renderSlots(regularSlots)}
            </SidebarTabScroll>
          </SidebarRegularSection>
        </SidebarTabList>
      </SidebarHoverArea>
      {bubblePortal}
    </StyledSidebar>
  );
});
