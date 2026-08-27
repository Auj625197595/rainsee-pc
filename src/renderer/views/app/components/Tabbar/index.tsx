import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer, clipboard } from 'electron';

import { AddTab, StyledTabbar, TabsContainer, TabbarEnd, LinkDropIndicator } from './style';
import { Tabs } from '../Tabs';
import store from '../../store';
import { TabGroup } from '../TabGroup';
import { ICON_ADD } from '~/renderer/constants/icons';
import { ToolbarButton } from '../ToolbarButton';
import { AddressBarContainer } from '../AddressBarContainer';
import { LayoutSwitcher } from '../LayoutSwitcher';
import { isURL, realurl } from '~/utils';
import { getExternalProtocol } from '~/utils/url';
import { useActionBubble } from '../../utils/action-bubble';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';
import {
  createTabWheelHandler,
  getTabScrollStep,
} from '../../utils/tab-wheel-switch';

const getSelectedTopTabElement = (): HTMLElement | null => {
  const tab = store.tabs.selectedTab;
  return tab?.ref?.current || tab?.tabGroup?.ref?.current || null;
};

const wheelHandler = createTabWheelHandler({
  axis: 'horizontal',
  getBehavior: () => store.settings.object.tabWheelBehavior || 'auto',
  getContainer: () => store.tabs.containerRef.current,
  onSwitch: (direction) => store.tabs.switchAdjacentTab(direction),
  onSwitched: (direction, behavior) => {
    window.requestAnimationFrame(() => {
      const container = store.tabs.containerRef.current;
      const selected = getSelectedTopTabElement();
      if (!container) return;

      store.tabs.scrollingToEnd = false;
      if (behavior === 'always-switch') {
        container.scrollLeft +=
          direction * getTabScrollStep(selected, 'horizontal', 72);
      }
      selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
});

let timeout: any;

const onMouseEnter = () => {
  clearTimeout(timeout);
};

const onTabsMouseLeave = () => {
  store.tabs.hoveredTabId = -1;
  ipcRenderer.send(`hide-tab-preview-${store.windowId}`);
  store.tabs.canShowPreview = true;

  timeout = setTimeout(() => {
    store.tabs.removedTabs = 0;
    store.tabs.updateTabsBounds(true);
  }, 300);
};

const onAddTabClick = () => {
  store.tabs.addTab();
};

const onTabsDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  if (!isLinkDragEvent(e)) return;
  // 必须 preventDefault 才能在松手时触发 drop。
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  const res = store.tabs.computeLinkDrop(e.clientX);
  if (res) store.tabs.setLinkDropLeft(res.indicatorLeft);
};

const onTabsDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
  // dragleave 在指针移过子标签时也会冒泡;仅当真正离开容器(relatedTarget 不在内部)时清除。
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
    return;
  }
  store.tabs.clearLinkDrop();
};

const onTabsDrop = (e: React.DragEvent<HTMLDivElement>) => {
  if (!isLinkDragEvent(e)) return;
  e.preventDefault();
  e.stopPropagation();
  store.tabs.clearLinkDrop();

  const url = getDraggedLinkURL(e.dataTransfer);
  if (!url) return;

  const res = store.tabs.computeLinkDrop(e.clientX);
  if (!res) return;
  // Left-button gesture drags carry a private MIME marker. Their foreground /
  // background preference is read from the gesture settings; ordinary
  // browser/bookmark drags remain foreground opens.
  let active = true;
  try {
    const action = e.dataTransfer?.getData('application/x-rainsee-left-gesture');
    if (action === '1') {
      active = store.settings.object.mouseLeftGestureOpenInBackground !== true;
    }
  } catch (_) {}
  store.tabs.openLinkAt(url, res.listIndex, -1, active);
};

export const TabGroups = observer(() => {
  return (
    <React.Fragment>
      {/* 仅渲染有成员的组:空组在 slot 抽象里不占位,这里也不渲染芯片,
          避免它在默认 left 处闪现。空组记录由 removeFromGroup 清理。 */}
      {store.tabGroups.list
        .filter((g) => g.tabs.length > 0)
        .map((item) => (
          <TabGroup key={item.id} tabGroup={item}></TabGroup>
        ))}
    </React.Fragment>
  );
});

export const Tabbar = observer(() => {
  const { show: showBubble, portal: bubblePortal } = useActionBubble();

  React.useEffect(() => {
    const container = store.tabs.containerRef.current;
    if (!container) return undefined;
    const onWheel = (event: WheelEvent) => {
      const result = wheelHandler(event);
      if (result.handled) event.preventDefault();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // 右键「+ 新建标签」按钮 → 读剪贴板:网址则新建标签打开、文本则搜索、空则提示。
  const onAddTabContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const raw = (clipboard.readText() || '').trim();
    if (raw === '') {
      showBubble('剪贴板没有内容', e.currentTarget);
      return;
    }

    const url = realurl(raw, store.settings.searchEngine.url);
    // 剪贴板是外部协议(motrixnext://、thunder://、magnet:、mailto: 等)→ 唤起系统应用,不新建标签加载。
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      showBubble('已在系统中打开链接', e.currentTarget);
      return;
    }
    store.tabs.addTab({ url, active: true });
    showBubble(isURL(raw) ? '已打开剪贴板网址' : '已搜索剪贴板', e.currentTarget);
  };

  return (
    <StyledTabbar data-rainsee-part="tab-bar">
      <TabsContainer
        $allowScroll={store.settings.object.tabOverflowBehavior !== 'shrink'}
        data-rainsee-part="tabs"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onTabsMouseLeave}
        onDragOver={onTabsDragOver}
        onDragLeave={onTabsDragLeave}
        onDrop={onTabsDrop}
        ref={store.tabs.containerRef}
      >
        <TabGroups />
        <Tabs />
        {/* 网页链接拖入时的投放指示线,与标签同坐标系,随容器滚动跟随。 */}
        {store.tabs.linkDropLeft != null && (
          <LinkDropIndicator
            style={{transform: `translateX(${store.tabs.linkDropLeft}px)`}}
          />
        )}
      </TabsContainer>
      {store.isCompact && <AddressBarContainer />}
      {!store.tabs.scrollable && (
        <AddTab
          rainseeAction="new-tab"
          icon={ICON_ADD}
          onClick={onAddTabClick}
          onContextMenu={onAddTabContextMenu}
          divRef={store.addTab.setRef}
        />
      )}
      <TabbarEnd>
        {store.tabs.scrollable && (
          <ToolbarButton
            rainseeAction="new-tab"
            icon={ICON_ADD}
            onClick={onAddTabClick}
            onContextMenu={onAddTabContextMenu}
          />
        )}
        <LayoutSwitcher variant="tab" />
      </TabbarEnd>
      {bubblePortal}
    </StyledTabbar>
  );
});
