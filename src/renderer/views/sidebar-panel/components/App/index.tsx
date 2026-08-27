import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { Plus } from '@phosphor-icons/react';

import { SidebarPanelContent, StyledApp } from './style';
import store, { IPanelTab } from '../../store';
import { useTabHoverActivation } from '~/renderer/utils/tab-hover-activation';
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
  SidebarGroupCount,
  SidebarGroupNameInput,
  SidebarGroupChevron,
  SidebarSwatches,
  SidebarSwatch,
  SidebarGroupSection,
  SidebarGroupAddButton,
} from '~/renderer/views/app/components/Sidebar/style';
import {
  StyledSidebarTab,
  SidebarTabIcon,
  SidebarTabPinBadge,
  SidebarTabTitle,
  SidebarTabClose,
  SidebarDropLine,
} from '~/renderer/views/app/components/SidebarTab/style';
import {
  ProfileBrandLogo,
  useProfileBrand,
} from '~/renderer/views/app/components/ProfileBrandLogo';
import { getIconByUrlNet } from '~/utils/url';
import {
  getDraggedLinkURL,
  isLinkDragEvent,
} from '~/renderer/views/app/utils/link-drop';
import { buildGroupSlots } from '~/renderer/views/app/utils/group-slots';
import {
  createTabWheelHandler,
  getTabScrollStep,
} from '~/renderer/views/app/utils/tab-wheel-switch';

const panelListRef = React.createRef<HTMLDivElement>();

const panelWheelHandler = createTabWheelHandler({
  axis: 'vertical',
  getBehavior: () => store.tabWheelBehavior,
  getContainer: () => panelListRef.current,
  onSwitch: (direction) => {
    store.action({ type: 'wheelSwitch', direction });
    return true;
  },
  onSwitched: (direction, behavior) => {
    if (behavior !== 'always-switch') return;
    window.requestAnimationFrame(() => {
      const container = panelListRef.current;
      const selected = container?.querySelector<HTMLElement>(
        '[data-sidebar-panel-tab-id][data-rainsee-selected="true"]',
      );
      if (!container) return;
      container.scrollTop +=
        direction * getTabScrollStep(selected, 'vertical', 42);
    });
  },
});

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

const ChevronIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// 实心钉子 = 固定模式。浮层里点击即切回固定模式并收起浮层。
const PinIcon = (
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

const SidebarBrandMark = () => {
  const brandRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<number | null>(null);
  const profileBrand = useProfileBrand();

  const clearOpenTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const openPanel = () => {
    clearOpenTimer();
    const el = brandRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 当前页面运行在独立 BrowserView 中，只回传浮层内坐标；宿主负责叠加
    // sidebar-panel 的窗口坐标，再打开手机标签面板。
    store.action({
      type: 'openPhoneTabs',
      left: Math.round(rect.left),
      bottom: Math.round(rect.bottom),
    });
  };

  const onMouseEnter = () => {
    clearOpenTimer();
    timerRef.current = window.setTimeout(openPanel, 250);
  };

  React.useEffect(() => clearOpenTimer, []);

  return (
    <SidebarBrand
      ref={brandRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={clearOpenTimer}
      onMouseDown={clearOpenTimer}
      onClick={openPanel}
    >
      <ProfileBrandLogo
        profileName={profileBrand.profileName}
        logoDataUrl={profileBrand.logoDataUrl}
        appIcon={APP_ICON}
        onInteractStart={clearOpenTimer}
        onSelect={profileBrand.selectLogo}
      />
      <SidebarBrandText>
        {profileBrand.profileName || '雨见浏览器'}
      </SidebarBrandText>
    </SidebarBrand>
  );
};

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

const onPanelMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
  const bounds = e.currentTarget.getBoundingClientRect();
  const edgeTolerance = 2;
  const leftEdgeExit =
    store.side === 'left' && e.clientX <= bounds.left + edgeTolerance;
  const rightEdgeExit =
    store.side === 'right' && e.clientX >= bounds.right - edgeTolerance;

  // 贴住窗口外沿时 Electron 在全屏/最大化状态下可能派发 mouseleave。
  // 外沿是侧栏的驻留方向，只有朝网页内容一侧移出时才应开始收起。
  if (leftEdgeExit || rightEdgeExit) {
    store.notifyEnter();
    return;
  }

  store.notifyLeave();
};

const getDraggedPanelTab = () =>
  store.tabs.find((tab) => tab.id === store.tabDragId);

const updateTabDropTarget = (dragged: IPanelTab, x: number, y: number) => {
  const target = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>(
      '[data-sidebar-panel-tab-id], [data-sidebar-panel-group-id]',
    );
  if (!target) {
    store.clearTabDrop();
    return;
  }

  const tabId = Number(target.dataset.sidebarPanelTabId);
  if (Number.isFinite(tabId)) {
    const tab = store.tabs.find((item) => item.id === tabId);
    if (!tab || tab.id === dragged.id || !!tab.pinned !== !!dragged.pinned) {
      store.clearTabDrop();
      return;
    }
    const bounds = target.getBoundingClientRect();
    store.setTabDropTarget(tab.id, y < bounds.top + bounds.height / 2);
    return;
  }

  const groupId = Number(target.dataset.sidebarPanelGroupId);
  if (
    Number.isFinite(groupId) &&
    !dragged.pinned &&
    dragged.groupId !== groupId
  ) {
    store.setTabDropGroup(groupId);
  } else {
    store.clearTabDrop();
  }
};

const updateGroupDropTarget = (
  groupId: number,
  pinned: boolean,
  x: number,
  y: number,
) => {
  const target = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('[data-sidebar-panel-group-id]');
  const targetGroupId = Number(target?.dataset.sidebarPanelGroupId);
  const targetGroup = store.tabs.find((tab) => tab.groupId === targetGroupId);
  if (
    !target ||
    !Number.isFinite(targetGroupId) ||
    targetGroupId === groupId ||
    !targetGroup ||
    !!targetGroup.groupPinned !== pinned
  ) {
    store.setGroupDropTarget(-1, false);
    return;
  }
  const bounds = target.getBoundingClientRect();
  store.setGroupDropTarget(targetGroupId, y < bounds.top + bounds.height / 2);
};

const PanelTabRow = observer(({ tab }: { tab: IPanelTab }) => {
  const pointerRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [failedIconSources, setFailedIconSources] = React.useState<string[]>(
    [],
  );
  const hoverActivation = useTabHoverActivation({
    enabled:
      store.tabHoverActivationBehavior !== 'off' &&
      (!!tab.discarded ||
        store.tabHoverActivationBehavior === 'activate-and-switch'),
    delay: store.tabHoverActivationDelay,
    selected: tab.selected,
    activate: () =>
      store.action({ type: 'activateOnHover', tabId: tab.id }),
    blocked: () => store.tabDragId !== -1,
  });
  const prevUrlRef = React.useRef(tab.url);
  if (prevUrlRef.current !== tab.url) {
    setFailedIconSources([]);
    prevUrlRef.current = tab.url;
  }

  const fallbackIconSrc = tab.url ? getIconByUrlNet(tab.url) : undefined;
  const iconSrc = [tab.favicon, fallbackIconSrc].find(
    (src) => src && !failedIconSources.includes(src),
  );
  const isDropTarget =
    store.linkDropTargetId !== -1 && store.linkDropTargetId === tab.id;
  const isTabDropTarget =
    store.tabDropTargetId !== -1 && store.tabDropTargetId === tab.id;

  return (
    <StyledSidebarTab
      selected={tab.selected}
      groupColor={tab.groupColor}
      dragging={store.tabDragId === tab.id}
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
      onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
        hoverActivation.cancel();
        const control =
          e.target instanceof Element &&
          e.target.closest('[data-rainsee-action="close-tab"]');
        if (e.button !== 0 || control) return;
        pointerRef.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== e.pointerId) return;
        if (store.tabDragId === -1) {
          const distance = Math.hypot(
            e.clientX - pointer.x,
            e.clientY - pointer.y,
          );
          if (distance < 5) return;
          store.startTabDrag(tab.id);
        }
        if (store.tabDragId === tab.id) {
          updateTabDropTarget(tab, e.clientX, e.clientY);
        }
      }}
      onPointerUp={(e: React.PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== e.pointerId) return;
        pointerRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (store.tabDragId !== tab.id) {
          store.action({ type: 'select', tabId: tab.id });
          return;
        }
        updateTabDropTarget(tab, e.clientX, e.clientY);
        const dragged = getDraggedPanelTab();
        const anchorTabId = store.tabDropTargetId;
        const groupId = store.tabDropGroupId;
        const before = store.tabDropBefore;
        store.clearTabDrag();
        if (!dragged) return;
        if (anchorTabId !== -1) {
          store.action({
            type: 'moveTab',
            tabId: dragged.id,
            anchorTabId,
            before,
          });
        } else if (groupId !== -1) {
          store.action({
            type: 'moveTabIntoGroup',
            tabId: dragged.id,
            groupId,
          });
        }
      }}
      onPointerCancel={() => {
        hoverActivation.cancel();
        pointerRef.current = null;
        if (store.tabDragId === tab.id) store.clearTabDrag();
      }}
      onMouseDown={(e: React.MouseEvent) => {
        hoverActivation.cancel();
        if (e.button === 1) store.action({ type: 'close', tabId: tab.id });
      }}
      onMouseEnter={hoverActivation.schedule}
      onMouseLeave={hoverActivation.cancel}
      data-rainsee-part="sidebar-tab"
      data-rainsee-selected={tab.selected ? 'true' : 'false'}
      data-sidebar-panel-tab-id={tab.id}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        store.action({
          type:
            store.closeTabOnRightClick && !e.shiftKey ? 'close' : 'contextmenu',
          tabId: tab.id,
        });
      }}
    >
      {isDropTarget && (
        <SidebarDropLine position={store.linkDropBefore ? 'top' : 'bottom'} />
      )}
      {isTabDropTarget && (
        <SidebarDropLine position={store.tabDropBefore ? 'top' : 'bottom'} />
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
              setFailedIconSources((sources) =>
                sources.includes(iconSrc) ? sources : [...sources, iconSrc],
              );
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
        visible={store.tabCloseButtonDisplay !== 'never'}
        hoverOnly={store.tabCloseButtonDisplay === 'hover'}
        onMouseEnter={hoverActivation.cancel}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        onPointerDown={(e: React.PointerEvent) => {
          hoverActivation.cancel();
          e.stopPropagation();
        }}
        onClick={(e: React.MouseEvent) => {
          hoverActivation.cancel();
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
    count,
    collapsed,
    pinned,
  }: {
    gid: number;
    color?: string;
    nameRaw?: string;
    nameShown: string;
    count: number;
    collapsed: boolean;
    pinned: boolean;
  }) => {
    const pointerRef = React.useRef<{
      pointerId: number;
      x: number;
      y: number;
    } | null>(null);
    const suppressClickRef = React.useRef(false);
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
        $dragging={store.groupDragId === gid}
        data-sidebar-panel-group-id={gid}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (paletteOpen || editing) return;
          store.action({ type: 'toggleGroup', groupId: gid });
        }}
        onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
          const control =
            e.target instanceof Element &&
            e.target.closest(
              'button, input, [data-sidebar-panel-group-control]',
            );
          if (e.button !== 0 || control || paletteOpen || editing) return;
          pointerRef.current = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.pointerId !== e.pointerId) return;
          if (store.groupDragId === -1) {
            const distance = Math.hypot(
              e.clientX - pointer.x,
              e.clientY - pointer.y,
            );
            if (distance < 5) return;
            store.startGroupDrag(gid);
          }
          if (store.groupDragId === gid) {
            updateGroupDropTarget(gid, pinned, e.clientX, e.clientY);
          }
        }}
        onPointerUp={(e: React.PointerEvent<HTMLDivElement>) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.pointerId !== e.pointerId) return;
          pointerRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          if (store.groupDragId !== gid) return;
          updateGroupDropTarget(gid, pinned, e.clientX, e.clientY);
          const anchorGroupId = store.groupDropTargetId;
          const before = store.groupDropBefore;
          suppressClickRef.current = true;
          store.clearGroupDrag();
          if (anchorGroupId !== -1) {
            store.action({
              type: 'moveGroup',
              groupId: gid,
              anchorGroupId,
              before,
            });
          }
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
          if (store.groupDragId === gid) store.clearGroupDrag();
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
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          store.action({
            type:
              store.closeTabOnRightClick && !e.shiftKey
                ? 'closegroup'
                : 'groupcontextmenu',
            groupId: gid,
          });
        }}
      >
        {store.groupDropTargetId === gid && (
          <SidebarDropLine
            position={store.groupDropBefore ? 'top' : 'bottom'}
          />
        )}
        {store.tabDropGroupId === gid && <SidebarDropLine position="top" />}
        <SidebarGroupDot
          data-sidebar-panel-group-control
          style={{ backgroundColor: color }}
          title="点击选择组色"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setPaletteOpen((v) => !v);
          }}
        />
        {paletteOpen && (
          <SidebarSwatches
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
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
        <SidebarGroupAddButton
          data-sidebar-panel-group-control
          type="button"
          title="在分组中新建标签页"
          aria-label="在分组中新建标签页"
          onMouseDown={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            store.action({ type: 'new', groupId: gid });
          }}
        >
          <Plus size={15} weight="bold" />
        </SidebarGroupAddButton>
        <SidebarGroupCount>{count}</SidebarGroupCount>
      </SidebarGroupHeader>
    );
  },
);

export const App = observer(() => {
  const selectedTabId = store.tabs.find((tab) => tab.selected)?.id ?? -1;

  React.useEffect(() => {
    const container = panelListRef.current;
    if (!container) return undefined;
    const onWheel = (event: WheelEvent) => {
      const result = panelWheelHandler(event);
      if (result.handled) event.preventDefault();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  React.useLayoutEffect(() => {
    if (selectedTabId === -1) return;
    panelListRef.current
      ?.querySelector<HTMLElement>(
        `[data-sidebar-panel-tab-id="${selectedTabId}"]`,
      )
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedTabId]);

  // 与固定模式一致地把标签铺开:分组聚拢成连续块(头 + 缩进成员行),散落/固定
  // 标签原位。用 buildGroupSlots 而非 lastGroupId 游标,避免同组成员在列表中
  // 被拆散时复制出多个组头(见 group-slots.ts 顶部说明)。
  const items: React.ReactNode[] = [];
  const slots = buildGroupSlots(store.tabs, (t) => (t.pinned ? -1 : t.groupId));

  for (const slot of slots) {
    if (slot.kind === 'tab') {
      items.push(<PanelTabRow key={slot.item.id} tab={slot.item} />);
      continue;
    }

    const gid = slot.groupId;
    const head = slot.items[0];
    const isCollapsed = !!store.groupsCollapsed[gid];

    items.push(
      <SidebarGroupSection
        key={`g${gid}`}
        $groupColor={head?.groupColor}
        $groupCollapsed={isCollapsed}
      >
        <PanelGroupHeader
          gid={gid}
          color={head?.groupColor}
          nameRaw={head?.groupNameRaw}
          nameShown={head?.groupName || '分组'}
          count={slot.items.length}
          collapsed={isCollapsed}
          pinned={!!head?.groupPinned}
        />
        {!isCollapsed &&
          slot.items.map((tab) => <PanelTabRow key={tab.id} tab={tab} />)}
      </SidebarGroupSection>,
    );
  }

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp
        onMouseEnter={() => store.notifyEnter()}
        onMouseLeave={onPanelMouseLeave}
      >
        <UIStyle />
        <SidebarPanelContent key={store.showSeq} side={store.side}>
          <SidebarHeader>
            <SidebarBrandMark />
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
            ref={panelListRef}
            onDragOver={onListDragOver}
            onDragLeave={onListDragLeave}
            onDrop={onListDrop}
          >
            {items}
          </SidebarTabList>
        </SidebarPanelContent>
      </StyledApp>
    </ThemeProvider>
  );
});
