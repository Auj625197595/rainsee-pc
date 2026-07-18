import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { ITab, ITabGroup } from '../../models';
import store from '../../store';
import { showTabGroupContextMenu } from '../../utils/tab-context-menu';
import {
  StyledTabGroup,
  Chip,
  FavRow,
  Fav,
  ActiveTitle,
  CountBadge,
} from './style';

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

const ChipFav = observer(({ tab }: { tab: ITab }) => (
  <Fav
    selected={tab.isSelected}
    title={tab.title}
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      tab.select();
    }}
    onMouseEnter={() => {
      if (!store.tabs.isDragging) store.tabs.hoveredTabId = tab.id;
    }}
  >
    {tab.favicon !== '' ? <img src={tab.favicon} alt="" /> : <GlobeIcon />}
  </Fav>
));

export const TabGroup = observer(({ tabGroup }: { tabGroup: ITabGroup }) => {
  const openTimer = React.useRef<any>(null);

  const tabs = tabGroup.tabs;
  const containsActive = tabs.some((t) => t.isSelected);
  const activeTab = tabGroup.activeTab;
  const fallbackSiteName = activeTab?.title || '新标签页';
  const displayLabel = containsActive
    ? activeTab?.title || ''
    : tabGroup.name || fallbackSiteName;
  // 拖拽合入的高亮态:某标签正被拖动且悬停在本组芯片上方(松手即合入)。观察
  // store.tabs.pendingGroupDropId,命中本组则加醒目的投放环,呼应 Chrome 交互。
  const isDropTarget = store.tabs.pendingGroupDropId === tabGroup.id;

  // 芯片 DOM 挂载后立即 snap 到目标 left/width(无动画,早于浏览器绘制),
  // 消除新建分组时芯片从 left:0"飞入"。同步 updateTabsBounds 跑在挂载前,
  // 那次 animateTab 拿到的是 null ref,只更新了模型 left/width 值未落到 DOM;
  // 这里用那已算好的值补首帧定位。
  React.useLayoutEffect(() => {
    if (!tabGroup.positioned && tabGroup.ref.current) {
      tabGroup.setWidth(tabGroup.width, false);
      tabGroup.setLeft(tabGroup.left, false);
      tabGroup.positioned = true;
    }
  });

  const open = () => {
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
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
      ref={tabGroup.ref}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onContextMenu={(e: React.MouseEvent) => {
        // 右键芯片 → 整组原生右键菜单(新建/固定/取消分组/关闭分组)。命名改到
        // 悬停弹窗内联输入框,不再打开旧的命名编辑弹窗。
        e.preventDefault();
        showTabGroupContextMenu(tabGroup);
      }}
    >
      <Chip
        color={tabGroup.color}
        containsActive={containsActive}
        pinned={tabGroup.isPinned}
        dropTarget={isDropTarget}
      >
        <FavRow>
          {tabs.map((tab) => (
            <ChipFav key={tab.id} tab={tab} />
          ))}
        </FavRow>
        {!tabGroup.isPinned && displayLabel !== '' && (
          <ActiveTitle onClick={() => activeTab?.select()} title={displayLabel}>
            {displayLabel}
          </ActiveTitle>
        )}
        {!tabGroup.isPinned && <CountBadge>{tabs.length}</CountBadge>}
      </Chip>
    </StyledTabGroup>
  );
});
