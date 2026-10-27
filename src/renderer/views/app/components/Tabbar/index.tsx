import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { ipcRenderer, clipboard } from 'electron';

import {
  AddTab,
  StyledTabbar,
  TabsContainer,
  TabbarEnd,
  LinkDropIndicator,
  TabScrollExtent,
} from './style';
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
import { getShellTranslator } from '../../utils/i18n';
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
    store.tabs.removedTabRows = [];
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
  const res = store.tabs.computeLinkDrop(e.clientX, e.clientY);
  if (res) {
    store.tabs.setLinkDropPosition({
      left: res.indicatorLeft,
      top: res.indicatorTop,
    });
  }
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

  const res = store.tabs.computeLinkDrop(e.clientX, e.clientY);
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

  React.useLayoutEffect(() => {
    const container = store.tabs.containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    // 同时观察 StyledTabbar:品牌块宽度变化会移动第 0 行起点,而独立成栏时
    // 外扩后的容器总宽度可能不变。
    const bar = store.tabs.tabbarRef.current;
    const lastWidths = new Map<Element, number>();
    lastWidths.set(container, Math.round(container.getBoundingClientRect().width));
    if (bar) lastWidths.set(bar, Math.round(bar.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width || 0);
        if (!width || width === lastWidths.get(entry.target)) continue;
        lastWidths.set(entry.target, width);
        changed = true;
      }
      if (!changed) return;
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        store.tabs.updateTabsBounds(false);
      });
    });
    observer.observe(container);
    if (bar) observer.observe(bar);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = store.tabs.containerRef.current;
      const selected = getSelectedTopTabElement();
      if (!container || !selected) return;
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      if (selectedRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - selectedRect.left;
      } else if (selectedRect.right > containerRect.right) {
        container.scrollLeft += selectedRect.right - containerRect.right;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [store.tabs.selectedTabId, store.tabs.scrollable]);

  // 右键「+ 新建标签」按钮 → 读剪贴板:网址则新建标签打开、文本则搜索、空则提示。
  const onAddTabContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = getShellTranslator();
    e.preventDefault();
    e.stopPropagation();

    const raw = (clipboard.readText() || '').trim();
    if (raw === '') {
      showBubble(t('shellClipboardEmpty'), e.currentTarget);
      return;
    }

    const url = realurl(raw, store.settings.searchEngine.url);
    // 剪贴板是外部协议(motrixnext://、thunder://、magnet:、mailto: 等)→ 唤起系统应用,不新建标签加载。
    if (getExternalProtocol(url)) {
      ipcRenderer.send('open-external-url', url);
      showBubble(t('shellOpenedExternal'), e.currentTarget);
      return;
    }
    store.tabs.addTab({ url, active: true });
    showBubble(
      isURL(raw) ? t('shellOpenedClipboardUrl') : t('shellSearchedClipboard'),
      e.currentTarget,
    );
  };

  return (
    <StyledTabbar
      data-rainsee-part="tab-bar"
      ref={store.tabs.tabbarRef}
      $fullRows={store.tabs.fullWidthRows}
    >
      <TabsContainer
        $allowScroll={store.settings.object.tabOverflowBehavior !== 'shrink'}
        $inset={store.tabs.fullWidthRows ? store.tabs.fullRowInset : undefined}
        data-rainsee-part="tabs"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onTabsMouseLeave}
        onDragOver={onTabsDragOver}
        onDragLeave={onTabsDragLeave}
        onDrop={onTabsDrop}
        ref={store.tabs.containerRef}
      >
        <TabScrollExtent $width={store.tabs.scrollContentWidth} />
        <TabGroups />
        <Tabs />
        {/* 网页链接拖入时的投放指示线,与标签同坐标系,随容器滚动跟随。 */}
        {store.tabs.linkDropPosition != null && (
          <LinkDropIndicator
            style={{
              transform: `translate(${store.tabs.linkDropPosition.left}px, ${store.tabs.linkDropPosition.top}px)`,
            }}
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
      <TabbarEnd ref={store.tabs.tabbarEndRef}>
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
