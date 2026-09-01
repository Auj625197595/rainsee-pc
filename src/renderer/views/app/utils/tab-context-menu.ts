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
import { getShellTranslator } from './i18n';

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
  const t = getShellTranslator();
  const tabs = store.tabs.list.filter(
    (x) => !x.isClosing && x.tabGroupId === tabGroup.id,
  );
  const tabsLength = tabs.length;
  const tabTitle = tabs[0]?.title || t('newTab');

  // 分组成员可能在原生菜单异步构建期间全部关闭,此时仍保留可用的
  // 文案兜底,避免访问 tabs[0].title 触发运行时异常。
  if (tabsLength === 0) return tabGroup.name || t('tcmEmptyGroup');

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
  const t = getShellTranslator();
  return remote.Menu.buildFromTemplate([
    {
      label: t('tcmCreateGroup'),
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

// 分组标签的左右范围只包含同组成员；未分组标签仍按整个标签列表计算。
const getSiblingTabs = (tab: ITab): ITab[] => {
  if (tab.tabGroupId === -1) return store.tabs.list;
  return store.tabs.list.filter((t) => t.tabGroupId === tab.tabGroupId);
};

export const closeTabGroup = (tabGroup: ITabGroup) => {
  for (const tab of [...tabGroup.tabs]) tab.close();
};

export const handleTabContextMenu = (
  event: React.MouseEvent,
  tab: ITab,
) => {
  event.preventDefault();
  if (store.settings.object.closeTabOnRightClick && !event.shiftKey) {
    tab.close();
    return;
  }
  showTabContextMenu(tab);
};

export const handleTabGroupContextMenu = (
  event: React.MouseEvent,
  tabGroup: ITabGroup,
) => {
  event.preventDefault();
  if (store.settings.object.closeTabOnRightClick && !event.shiftKey) {
    closeTabGroup(tabGroup);
    return;
  }
  showTabGroupContextMenu(tabGroup);
};

// 标签页原生右键菜单,顶部标签栏与左右侧栏共用同一份。
// 原生菜单图标需提前栅格化(异步),并行解析后再构建模板。
export const showTabContextMenu = async (tab: ITab, onClose?: () => void) => {
  const t = getShellTranslator();
  const tabGroups: ITabGroup[] = store.tabGroups
    .getGroups()
    .filter(
      (t) =>
        t.id !== tab.tabGroupId &&
        store.tabs.list.some(
          (x) => !x.isClosing && x.tabGroupId === t.id,
        ),
    );

  // 顶部标签栏为横向(左/右),左右侧栏为纵向(上/下)。
  // 仅文案与图标随布局变化,关闭逻辑按当前范围的下标关前/关后。
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
      label: t('tcmNewTabRight'),
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
      label: t('tcmAddToNewGroup'),
      icon: icNewGroup,
      visible: !tab.isPinned && tabGroups.length === 0,
      click: () => {
        addTabToNewGroup(tab);
      },
    },
    {
      label: t('tcmAddToGroup'),
      icon: icAddGroup,
      visible: !tab.isPinned && tabGroups.length > 0,
      submenu: tabGroupSubmenu(tab, tabGroups),
    },
    {
      label: t('tcmRemoveFromGroup'),
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
      label: t('tcmReload'),
      icon: icReload,
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        tab.callViewMethod('reload');
      },
    },
    {
      label: t('tcmDuplicate'),
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
      label: t('tcmShare'),
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
      label: tab.isPinned ? t('tcmUnpin') : t('tcmPin'),
      icon: icPin,
      click: () => {
        tab.isPinned ? store.tabs.unpinTab(tab) : store.tabs.pinTab(tab);
      },
    },
    {
      label: tab.isMuted ? t('tcmUnmute') : t('tcmMute'),
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
      label: t('tcmOpenNewWindow'),
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
      label: t('close'),
      icon: icClose,
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        tab.close();
      },
    },
    {
      label: t('tcmCloseOthers'),
      icon: icCloseOthers,
      click: async () => {
        // 先显式激活右键目标标签。对内存节省模式下的占位标签,只有 select()
        // 才会触发 materialize/恢复；否则批量关闭其它标签后,UI 可能已切到它,
        // 但内容视图尚未真正创建。
        if (!tab.isSelected) {
          await tab.select();
        }

        // Chrome:批量关闭跳过固定标签(固定标签始终存活)。
        // 同时跳过标签组内的标签(组作为整体保留),只关未分组的普通标签。
        const tabsToClose = store.tabs.list.filter(
          (t) => t !== tab && !t.isPinned && t.tabGroupId === -1,
        );
        for (const t of tabsToClose) {
          t.close();
        }
      },
    },
    {
      label: vertical ? t('tcmCloseAbove') : t('tcmCloseLeft'),
      icon: icCloseLeft,
      click: () => {
        const siblingTabs = getSiblingTabs(tab);
        // 跳过固定标签(位置无关判定:固定标签即便在上方/左侧也不关)。
        // 跳过其它标签组:标签组作为整体保留,只关与当前标签同组/同属未分组的标签。
        for (let i = siblingTabs.indexOf(tab) - 1; i >= 0; i--) {
          const t = siblingTabs[i];
          if (!t.isPinned && t.tabGroupId === tab.tabGroupId) t.close();
        }
      },
    },
    {
      label: vertical ? t('tcmCloseBelow') : t('tcmCloseRight'),
      icon: icCloseRight,
      click: () => {
        const siblingTabs = getSiblingTabs(tab);
        for (
          let i = siblingTabs.length - 1;
          i > siblingTabs.indexOf(tab);
          i--
        ) {
          const t = siblingTabs[i];
          if (!t.isPinned && t.tabGroupId === tab.tabGroupId) t.close();
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: t('tcmReopenClosed'),
      icon: icRevert,
      enabled: store.tabs.recentlyClosed.length > 0,
      click: () => {
        store.tabs.revertClosed();
      },
    },
  ]);

  menu.popup({ callback: onClose } as any);
};

// 标签组芯片原生右键菜单(取代旧的"命名/颜色"编辑弹窗)。命名改到悬停弹窗内联
// 输入框完成,这里只放整组操作。
export const showTabGroupContextMenu = async (
  tabGroup: ITabGroup,
  onClose?: () => void,
) => {
  const t = getShellTranslator();
  const [icNewTab, icPin, icUngroup, icClose] = await Promise.all([
    menuIcon(Plus),
    menuIcon(tabGroup.isPinned ? PushPinSlash : PushPin),
    menuIcon(FolderMinus),
    menuIcon(X),
  ]);

  const menu = remote.Menu.buildFromTemplate([
    {
      label: t('shellNewTabInGroup'),
      icon: icNewTab,
      click: () => {
        store.tabs.addTab({ active: true }, tabGroup.id);
      },
    },
    {
      type: 'separator',
    },
    {
      label: tabGroup.isPinned ? t('tcmUnpinGroup') : t('tcmPinGroup'),
      icon: icPin,
      click: () => {
        store.tabs.setGroupPinned(tabGroup, !tabGroup.isPinned);
      },
    },
    {
      label: t('tcmUngroup'),
      icon: icUngroup,
      click: () => {
        store.tabs.dissolveGroup(tabGroup);
      },
    },
    {
      label: t('tcmCloseGroup'),
      icon: icClose,
      click: () => {
        closeTabGroup(tabGroup);
      },
    },
  ]);

  menu.popup({ callback: onClose } as any);
};
