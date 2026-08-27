import { VIEW_Y_OFFSET, SIDEBAR_RAIL_WIDTH } from '~/constants/design';
import { BrowserWindow, ipcMain } from 'electron';
import { Application } from '../application';
import { EXTERNAL_NAVIGATION_PERMISSION } from '~/utils/permissions';

const DIALOG_WIDTH = 396;
const DIALOG_HEIGHT = 248;
const EXTERNAL_DIALOG_WIDTH = 560;
const EXTERNAL_DIALOG_HEIGHT = 108;

// 标签页侧边栏位于左侧时,网页内容区从侧边栏右缘开始;权限弹窗应贴在内容区
// 左上角,故 x 偏移一个侧边栏宽度。收起(sidebarPinned=false)走固定窄轨 62px,
// 展开走 settings.sidebarWidth。右侧/顶部布局及 HTML 全屏(侧边栏隐藏)时不偏移。
const getSidebarXOffset = (appWindow: any): number => {
  if (appWindow?.viewManager?.fullscreen) return 0;
  const settings = Application.instance.settings.object;
  if (settings.tabsLayout !== 'left') return 0;
  const pinned = (settings as any).sidebarPinned !== false;
  return pinned ? settings.sidebarWidth : SIDEBAR_RAIL_WIDTH;
};

export const requestPermission = (
  browserWindow: BrowserWindow,
  name: string,
  url: string,
  details: any,
  tabId: number,
): Promise<{ allowed: boolean; remember: boolean }> => {
  return new Promise((resolve, reject) => {
    if (
      name === 'unknown' ||
      (name === 'media' && details.mediaTypes.length === 0) ||
      name === 'midiSysex'
    ) {
      return reject('Unknown permission');
    }

    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    // tabId 可能是 window.open 覆盖页的物理 id；弹窗状态必须关联到根标签。
    const tab = appWindow.viewManager.findViewByWebContentsId(tabId);
    if (!tab) {
      resolve({allowed: false, remember: false});
      return;
    }
    const logicalTabId = tab.id;
    tab.requestedPermission = { name, url, details };
    const externalNavigation = name === EXTERNAL_NAVIGATION_PERMISSION;
    let settled = false;
    let resizeChannel = '';
    let dialog: any = null;

    const settle = (
      result: {allowed: boolean; remember: boolean},
      hide = true,
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (resizeChannel) ipcMain.removeAllListeners(resizeChannel);
      if (hide) dialog?.hide();
    };

    dialog = Application.instance.dialogs.show({
      name: 'permissions',
      browserWindow,
      getBounds: () => {
        if (!externalNavigation) {
          return {
            width: DIALOG_WIDTH,
            height: DIALOG_HEIGHT,
            x: getSidebarXOffset(appWindow),
            y: VIEW_Y_OFFSET,
          };
        }

        const windowBounds = browserWindow.getContentBounds();
        const area = appWindow.viewManager.contentBounds || tab.bounds || {
          x: 0,
          y: VIEW_Y_OFFSET,
          width: windowBounds.width,
          height: Math.max(0, windowBounds.height - VIEW_Y_OFFSET),
        };
        const width = Math.min(
          EXTERNAL_DIALOG_WIDTH,
          Math.max(320, area.width - 32),
        );
        return {
          width,
          height: EXTERNAL_DIALOG_HEIGHT,
          x: area.x + Math.max(0, Math.round((area.width - width) / 2)),
          y: area.y + Math.max(0, area.height - EXTERNAL_DIALOG_HEIGHT - 16),
        };
      },
      tabAssociation: {
        tabId: logicalTabId,
        getTabInfo: (tabId) => {
          return appWindow.viewManager.getById(tabId)?.requestedPermission;
        },
      },
      onWindowBoundsUpdate: (disposition) => {
        if (disposition === 'resize') dialog.rearrange();
      },
      onHide: () =>
        settle({allowed: false, remember: false}, false),
    });

    if (!dialog) {
      settle({allowed: false, remember: false}, false);
      return;
    }

    resizeChannel = `resize-dialog-${dialog.id}`;
    ipcMain.on(resizeChannel, (e, nextHeight: number) => {
      if (externalNavigation) return;
      dialog.rearrange({
        height: nextHeight,
      });
    });

    dialog.on('result', (e, result) => {
      if (typeof result === 'boolean') {
        settle({allowed: result, remember: true});
      } else {
        settle({
          allowed: Boolean(result?.allowed),
          remember: Boolean(result?.remember),
        });
      }
    });
  });
};
