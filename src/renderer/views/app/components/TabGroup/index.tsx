import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { ITab, ITabGroup } from '../../models';
import { TAB_MIN_WIDTH, TAB_PINNED_WIDTH } from '../../constants';
import store from '../../store';
import { handleTabGroupContextMenu } from '../../utils/tab-context-menu';
import { getShellTranslator } from '../../utils/i18n';
import { getIconByUrlNet } from '~/utils/url';
import {
  StyledTabGroup,
  Chip,
  FavRow,
  Fav,
  ActiveTitle,
  CountBadge,
} from './style';
import { useTabHoverActivation } from '~/renderer/utils/tab-hover-activation';

// 悬停弹窗出现延迟,贴近标签预览卡的节奏。鼠标离开交由 store 统一管理定时器,
// 与弹窗(独立 BrowserView)的鼠标进出协调,避免在「芯片↔弹窗」之间移动时闪烁关闭。
const HOVER_OPEN_DELAY = 250;

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

const ChipFav = observer(({ tab, density }: { tab: ITab; density: number }) => {
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
    blocked: () => store.tabs.isDragging,
  });

  // 图标源优先级与散落标签 <Tab> 完全一致:本地 favicon → 网络图标服务兜底
  // → 地球图标;任一来源解码失败后尝试下一级,tab.url 变化时重置失败列表。
  // 芯片此前只认 favicon,导航清空/抓取失败/占位标签时直接露出默认地球,
  // 与同站散落标签的显示不一致(用户感知为「分组聚焦后图标变默认」)。
  const [failedIconSources, setFailedIconSources] = React.useState<string[]>(
    [],
  );
  const prevUrlRef = React.useRef(tab.url);
  if (prevUrlRef.current !== tab.url) {
    setFailedIconSources([]);
    prevUrlRef.current = tab.url;
  }

  const fallbackIconSrc = tab.url ? getIconByUrlNet(tab.url) : undefined;
  const iconSrc = [tab.favicon, fallbackIconSrc].find(
    (src) => src && !failedIconSources.includes(src),
  );

  return (
    <Fav
      $density={density}
      selected={tab.isSelected}
      title={tab.displayTitle}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        hoverActivation.cancel();
        tab.select();
      }}
      onMouseDown={hoverActivation.cancel}
      onMouseEnter={() => {
        if (!store.tabs.isDragging) {
          store.tabs.hoveredTabId = tab.id;
          hoverActivation.schedule();
        }
      }}
      onMouseLeave={hoverActivation.cancel}
    >
      {iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          draggable={false}
          onError={() => {
            setFailedIconSources((sources) =>
              sources.includes(iconSrc) ? sources : [...sources, iconSrc],
            );
          }}
        />
      ) : (
        <GlobeIcon />
      )}
    </Fav>
  );
});

export const TabGroup = observer(({ tabGroup }: { tabGroup: ITabGroup }) => {
  const t = getShellTranslator();
  const openTimer = React.useRef<any>(null);
  const mountedElement = React.useRef<HTMLDivElement | null>(null);

  const tabs = tabGroup.tabs;
  const containsActive = tabs.some((t) => t.isSelected);
  const activeTab = tabGroup.activeTab;
  const fallbackSiteName = activeTab?.title || t('newTab');
  const displayLabel = containsActive
    ? activeTab?.title || ''
    : tabGroup.name || fallbackSiteName;
  // 拖拽合入的高亮态:某标签正被拖动且悬停在本组芯片上方(松手即合入)。观察
  // store.tabs.pendingGroupDropId,命中本组则加醒目的投放环,呼应 Chrome 交互。
  const isDropTarget = store.tabs.pendingGroupDropId === tabGroup.id;
  const isDragging = store.tabs.draggingGroupId === tabGroup.id;
  const preferredWidth = tabGroup.isPinned ? TAB_PINNED_WIDTH : TAB_MIN_WIDTH;
  const density =
    store.settings.object.tabOverflowBehavior === 'shrink'
      ? Math.max(0, Math.min(1, tabGroup.width / preferredWidth))
      : 1;

  // 芯片 DOM 挂载后立即 snap 到目标 left/width(无动画,早于浏览器绘制),
  // 消除新建分组时芯片从 left:0"飞入"。同步 updateTabsBounds 跑在挂载前,
  // 那次 animateTab 拿到的是 null ref,只更新了模型 left/width 值未落到 DOM;
  // 这里用那已算好的值补首帧定位。
  React.useLayoutEffect(() => {
    const element = tabGroup.ref.current;
    if (element && mountedElement.current !== element) {
      tabGroup.setWidth(tabGroup.width, false);
      tabGroup.setPosition(tabGroup.left, tabGroup.top, false);
      mountedElement.current = element;
    }
  });

  // 记录按下位置:芯片 mousedown 即进入整组拖拽,mouseup 后仍会派发 click。
  // 位移超过阈值视为拖拽,不打开总览。
  const pressPoint = React.useRef<{ x: number; y: number } | null>(null);

  const open = () => {
    if (store.tabs.isDragging || store.tabs.overviewVisible) return;
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (store.tabs.isDragging) return;
      const el = tabGroup.ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      store.tabs.openGroupPreview(tabGroup, { x: r.left, y: r.bottom + 6 });
    }, HOVER_OPEN_DELAY);
  };

  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    store.tabs.schedulePreviewHide();
  };

  React.useEffect(() => () => clearTimeout(openTimer.current), []);

  return (
    <StyledTabGroup
      data-rainsee-part="tab-group"
      data-rainsee-selected={containsActive ? 'true' : 'false'}
      data-rainsee-pinned={tabGroup.isPinned ? 'true' : 'false'}
      $dragging={isDragging}
      $row={Math.round(tabGroup.top / Math.max(1, store.tabs.tabRowPitch))}
      ref={tabGroup.ref}
      onMouseDown={(e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        clearTimeout(openTimer.current);
        pressPoint.current = { x: e.pageX, y: e.pageY };
        store.tabs.beginGroupDrag(tabGroup, e.pageX, e.pageY);
      }}
      onClick={(e: React.MouseEvent) => {
        const start = pressPoint.current;
        pressPoint.current = null;
        if (!start || Math.hypot(e.pageX - start.x, e.pageY - start.y) >= 5) {
          return;
        }
        clearTimeout(openTimer.current);
        store.tabs.toggleGroupOverview(tabGroup);
      }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onContextMenu={(e: React.MouseEvent) => {
        handleTabGroupContextMenu(e, tabGroup);
      }}
    >
      <Chip
        data-rainsee-part="tab-group-surface"
        $density={density}
        color={tabGroup.color}
        containsActive={containsActive}
        pinned={tabGroup.isPinned}
        dropTarget={isDropTarget}
      >
        <FavRow>
          {tabs.map((tab) => (
            <ChipFav key={tab.id} tab={tab} density={density} />
          ))}
        </FavRow>
        {!tabGroup.isPinned && displayLabel !== '' && (
          <ActiveTitle $density={density} title={displayLabel}>
            {displayLabel}
          </ActiveTitle>
        )}
        {!tabGroup.isPinned && (
          <CountBadge $density={density}>{tabs.length}</CountBadge>
        )}
      </Chip>
    </StyledTabGroup>
  );
});
