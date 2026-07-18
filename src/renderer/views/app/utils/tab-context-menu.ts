import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Plus,
  FolderPlus,
  Folders,
  FolderMinus,
  ArrowClockwise,
  Copy,
  PushPin,
  PushPinSlash,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  ArrowSquareOut,
  X,
  Prohibit,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowLineUp,
  ArrowLineDown,
  ArrowUUpLeft,
  ShareNetwork,
} from '@phosphor-icons/react';
import { ipcRenderer, nativeImage, Menu } from 'electron';
import * as remote from '@electron/remote';

import { ITab, ITabGroup } from '../models';
import store from '../store';

// 将 phosphor 图标渲染为 nativeImage,用于原生右键菜单。
// Electron 的 nativeImage 不支持 SVG,需经 canvas 栅格化为 PNG。
// 颜色跟随原生菜单主题(系统深/浅色),保证图标与文字对比一致。
const menuIcon = (
  IconComponent: React.ComponentType<any>,
): Promise<Electron.NativeImage> => {
  const dark = remote.nativeTheme.shouldUseDarkColors;
  const color = dark ? '#e3e3e3' : '#1c1c1c';
  const svg = renderToStaticMarkup(
    React.createElement(IconComponent, { size: 16, color, weight: 'regular' }),
  );
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      resolve(nativeImage.createFromDataURL(canvas.toDataURL()));
    };
    img.onerror = () => resolve(nativeImage.createEmpty());
    img.src = url;
  });
};

const addTabToNewGroup = (tab: ITab): void => {
  tab.removeFromGroup();
  const tabGroup = store.tabGroups.addGroup();
  tab.tabGroupId = tabGroup.id;
  store.tabs.updateTabsBounds(true);
  // 持久化新分组归属(removeFromGroup 已持久化 -1,这里写回新组 id)。
  store.startupTabs.updateStartupTabItem(tab);
};

const tabGroupLabel = (tabGroup: ITabGroup): string => {
  const tabs = store.tabs.list.filter((x) => x.tabGroupId === tabGroup.id);
  const tabsLength = tabs.length;
  const tabTitle = tabs[0].title;

  let label =
    tabGroup.name ||
    `"${tabTitle.substr(0, 20)}${tabTitle.length > 20 ? '... ' : ''}"`;

  if (!tabGroup.name && tabsLength > 1) {
    label += ` and ${tabsLength - 1} other tabs`;
  }
  return label;
};

const tabGroupIcon = (color: string): nativeImage => {
  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');
  canvas.width = canvas.height = 12;

  context.fillStyle = color;
  context.beginPath();
  context.ellipse(
    canvas.width / 2,
    canvas.height / 2,
    canvas.width / 2,
    canvas.height / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  return nativeImage.createFromDataURL(canvas.toDataURL());
};

const tabGroupSubmenu = (tab: ITab, tabGroups: ITabGroup[]): Menu => {
  return remote.Menu.buildFromTemplate([
    {
      label: '创建分组',
      click: () => {
        addTabToNewGroup(tab);
      },
    },
    {
      type: 'separator',
    },
    ...tabGroups.map((tabGroup) => ({
      label: tabGroupLabel(tabGroup),
      icon: tabGroupIcon(tabGroup.color),
      click: () => {
        store.tabs.setTabToGroup(tab, tabGroup.id);
      },
    })),
  ]);
};

// 标签页原生右键菜单,顶部标签栏与左右侧栏共用同一份。
// 原生菜单图标需提前栅格化(异步),并行解析后再构建模板。
export const showTabContextMenu = async (tab: ITab) => {
  const tabGroups: ITabGroup[] = store.tabGroups
    .getGroups()
    .filter((t) => t.id !== tab.tabGroupId);

  // 顶部标签栏为横向(左/右),左右侧栏为纵向(上/下)。
  // 仅文案与图标随布局变化,关闭逻辑(按下标关前/关后)不变。
  const vertical = store.tabsLayout !== 'top';

  const [
    icNewTab,
    icNewGroup,
    icAddGroup,
    icRemoveGroup,
    icReload,
    icCopy,
    icShare,
    icPin,
    icMute,
    icNewWindow,
    icClose,
    icCloseOthers,
    icCloseLeft,
    icCloseRight,
    icRevert,
  ] = await Promise.all([
    menuIcon(Plus),
    menuIcon(FolderPlus),
    menuIcon(Folders),
    menuIcon(FolderMinus),
    menuIcon(ArrowClockwise),
    menuIcon(Copy),
    menuIcon(ShareNetwork),
    menuIcon(tab.isPinned ? PushPinSlash : PushPin),
    menuIcon(tab.isMuted ? SpeakerSimpleHigh : SpeakerSimpleSlash),
    menuIcon(ArrowSquareOut),
    menuIcon(X),
    menuIcon(Prohibit),
    menuIcon(vertical ? ArrowLineUp : ArrowLineLeft),
    menuIcon(vertical ? ArrowLineDown : ArrowLineRight),
    menuIcon(ArrowUUpLeft),
  ]);

  const menu = remote.Menu.buildFromTemplate([
    {
      label: '在右侧新增标签页',
      icon: icNewTab,
      click: () => {
        // 右键固定标签时,新标签落在固定区之后(首个非固定区位置),避免把未固定
        // 标签插进固定区。右键普通标签则紧邻当前选中标签之后。
        let index = store.tabs.list.indexOf(store.tabs.selectedTab) + 1;
        if (tab.isPinned) {
          const firstUnpinned = store.tabs.list.findIndex(
            (t) => !t.isClosing && !store.tabs.isTabInPinnedZone(t),
          );
          index = firstUnpinned === -1 ? store.tabs.list.length : firstUnpinned;
        }
        store.tabs.addTab(
          {
            index,
          },
          tab.isPinned ? -1 : tab.tabGroupId,
        );
      },
    },
    {
      label: '添加到新分组',
      icon: icNewGroup,
      visible: !tab.isPinned && tabGroups.length === 0,
      click: () => {
        addTabToNewGroup(tab);
      },
    },
    {
      label: '添加到分组',
      icon: icAddGroup,
      visible: !tab.isPinned && tabGroups.length > 0,
      submenu: tabGroupSubmenu(tab, tabGroups),
    },
    {
      label: '从分组中移除',
      icon: icRemoveGroup,
      visible: !tab.isPinned && !!tab.tabGroup,
      click: () => {
        tab.removeFromGroup();
      },
    },
    {
      type: 'separator',
    },
    {
      label: '刷新',
      icon: icReload,
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        tab.callViewMethod('webContents.reload');
      },
    },
    {
      label: '复制',
      icon: icCopy,
      click: async () => {
        // Chrome:复制固定标签得到紧邻其右侧的固定副本(pinTab 把副本插到固定块末尾)。
        const newTab = await store.tabs.addTab({ active: true, url: tab.url });
        if (newTab && tab.isPinned) {
          store.tabs.pinTab(newTab);
        }
      },
    },
    {
      label: '分享',
      icon: icShare,
      click: () => {
        // 带上右键标签页的 url/title,弹窗分享该页而非当前选中页(不切标签)。
        ipcRenderer.send(`show-share-dialog-${store.windowId}`, {
          url: tab.url,
          title: tab.title,
        });
      },
    },
    {
      label: tab.isPinned ? '取消固定' : '固定',
      icon: icPin,
      click: () => {
        tab.isPinned ? store.tabs.unpinTab(tab) : store.tabs.pinTab(tab);
      },
    },
    {
      label: tab.isMuted ? '取消静音' : '静音',
      icon: icMute,
      click: () => {
        tab.isMuted ? store.tabs.unmuteTab(tab) : store.tabs.muteTab(tab);
      },
    },
    {
      type: 'separator',
    },
    {
      type: 'separator',
    },
    {
      label: '在新窗口中打开',
      icon: icNewWindow,
      // 只剩一个标签时移到新窗只是平移窗口,无意义,隐藏。
      visible: store.tabs.list.filter((x) => !x.isClosing).length > 1,
      click: () => {
        // 组内标签撕离前先离组:撕离的 tabState 不带 tabGroupId,目标窗口按未分组
        // 领养;若不离组,源窗口的组会留下指向已迁出标签的悬空成员。
        if (tab.tabGroup) tab.removeFromGroup();
        ipcRenderer.send('tab-move-to-new-window', {
          sourceWindowId: store.windowId,
          tabId: tab.id,
          tabState: {
            url: tab.url,
            title: tab.title,
            favicon: tab.favicon,
            pinned: tab.isPinned,
            incognito: tab.incognito,
          },
        });
      },
    },
    {
      label: '关闭',
      icon: icClose,
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        tab.close();
      },
    },
    {
      label: '关闭其它标签',
      icon: icCloseOthers,
      click: async () => {
        // 先显式激活右键目标标签。对内存节省模式下的占位标签,只有 select()
        // 才会触发 materialize/恢复；否则批量关闭其它标签后,UI 可能已切到它,
        // 但内容视图尚未真正创建。
        if (!tab.isSelected) {
          await tab.select();
        }

        // Chrome:批量关闭跳过固定标签(固定标签始终存活)。
        const tabsToClose = store.tabs.list.filter(
          (t) => t !== tab && !t.isPinned,
        );
        for (const t of tabsToClose) {
          t.close();
        }
      },
    },
    {
      label: vertical ? '关闭上方标签' : '关闭左侧标签',
      icon: icCloseLeft,
      click: () => {
        // 跳过固定标签(位置无关判定:固定标签即便在上方/左侧也不关)。
        for (let i = store.tabs.list.indexOf(tab) - 1; i >= 0; i--) {
          const t = store.tabs.list[i];
          if (!t.isPinned) t.close();
        }
      },
    },
    {
      label: vertical ? '关闭下方标签' : '关闭右侧标签',
      icon: icCloseRight,
      click: () => {
        for (
          let i = store.tabs.list.length - 1;
          i > store.tabs.list.indexOf(tab);
          i--
        ) {
          const t = store.tabs.list[i];
          if (!t.isPinned) t.close();
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: '撤销关闭的标签',
      icon: icRevert,
      enabled: store.tabs.recentlyClosed.length > 0,
      click: () => {
        store.tabs.revertClosed();
      },
    },
  ]);

  menu.popup();
};

// 标签组芯片原生右键菜单(取代旧的"命名/颜色"编辑弹窗)。命名改到悬停弹窗内联
// 输入框完成,这里只放整组操作。
export const showTabGroupContextMenu = async (tabGroup: ITabGroup) => {
  const [icNewTab, icPin, icUngroup, icClose] = await Promise.all([
    menuIcon(Plus),
    menuIcon(tabGroup.isPinned ? PushPinSlash : PushPin),
    menuIcon(FolderMinus),
    menuIcon(X),
  ]);

  const menu = remote.Menu.buildFromTemplate([
    {
      label: '在分组中新建标签页',
      icon: icNewTab,
      click: () => {
        store.tabs.addTab({ active: true }, tabGroup.id);
      },
    },
    {
      type: 'separator',
    },
    {
      label: tabGroup.isPinned ? '取消固定分组' : '固定分组',
      icon: icPin,
      click: () => {
        store.tabs.setGroupPinned(tabGroup, !tabGroup.isPinned);
      },
    },
    {
      label: '取消分组',
      icon: icUngroup,
      click: () => {
        store.tabs.dissolveGroup(tabGroup);
      },
    },
    {
      label: '关闭分组',
      icon: icClose,
      click: () => {
        for (const t of tabGroup.tabs) t.close();
      },
    },
  ]);

  menu.popup();
};
