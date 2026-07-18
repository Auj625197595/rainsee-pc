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
import { RecentlyClosedTabs } from '../RecentlyClosedTabs';
import { isURL, realurl } from '~/utils';
import { getExternalProtocol } from '~/utils/url';
import { useActionBubble } from '../../utils/action-bubble';
import { getDraggedLinkURL, isLinkDragEvent } from '../../utils/link-drop';

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

const onWheel = (e: any) => {
  if (!store.tabs.containerRef) return;

  const { deltaX, deltaY } = e;
  const { scrollLeft } = store.tabs.containerRef.current;

  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : -deltaY;
  const target = delta / 2;

  store.tabs.scrollingToEnd = false;

  store.tabs.containerRef.current.scrollLeft = scrollLeft + target;
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
  store.tabs.openLinkAt(url, res.listIndex);
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
    <StyledTabbar>
      <TabsContainer
        onMouseEnter={onMouseEnter}
        onMouseLeave={onTabsMouseLeave}
        onWheel={onWheel}
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
          icon={ICON_ADD}
          onClick={onAddTabClick}
          onContextMenu={onAddTabContextMenu}
          divRef={store.addTab.setRef}
        />
      )}
      <TabbarEnd>
        {store.tabs.scrollable && (
          <ToolbarButton
            icon={ICON_ADD}
            onClick={onAddTabClick}
            onContextMenu={onAddTabContextMenu}
          />
        )}
        <LayoutSwitcher variant="tab" />
        <RecentlyClosedTabs variant="tab" />
      </TabbarEnd>
      {bubblePortal}
    </StyledTabbar>
  );
});
