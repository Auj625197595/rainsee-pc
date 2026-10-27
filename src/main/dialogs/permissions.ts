import { BrowserWindow, ipcMain } from 'electron';
import { Application } from '../application';
import { EXTERNAL_NAVIGATION_PERMISSION } from '~/utils/permissions';
import { getAppContentBounds } from './dialog';

const DIALOG_WIDTH = 396;
const DIALOG_HEIGHT = 248;
const EXTERNAL_DIALOG_WIDTH = 560;
const EXTERNAL_DIALOG_HEIGHT = 108;

// 权限弹窗始终相对最近一次测得的网页内容区定位,因此顶部标签栏高度和
// 左右侧栏变化都会自动反映到 x/y。
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
      (name === 'media' && (!Array.isArray(details.mediaTypes) || details.mediaTypes.length === 0))
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

    // 权限弹窗是动态 BrowserView,同一时间只能承载一个待决请求。
    // dialogs.show() 对同名动态弹窗会复用现有实例并返回 null,同时把新的
    // tabId 追加到旧实例。后续 hide() 只移除当前标签,会留下残留关联,导致
    // 用户点击允许后弹窗在切换标签时再次出现。新请求直接拒绝,不能改写当前弹窗。
    const pendingDialog = Application.instance.dialogs.getDynamic('permissions');
    if (pendingDialog) {
      console.warn(
        '[permissions] dialog already pending, rejecting concurrent request',
        {
          dialogId: pendingDialog.id,
          browserWindowId: browserWindow.id,
          tabId,
          logicalTabId: tab.id,
          selectedId: appWindow.viewManager.selectedId,
          requestedPermission: name,
          url,
        },
      );
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
      if (resizeChannel) {
        try {
          ipcMain.removeAllListeners(resizeChannel);
        } catch (error) {
          console.warn('[permissions] failed to remove resize listener', error);
        }
      }
      if (hide && dialog) {
        // 权限请求没有排队机制,结果一旦产生必须关闭整个弹窗。清空所有
        // 关联标签后再 hide,避免当前选中标签变化或旧残留 tabId 令 hide()
        // 提前返回,导致允许/拒绝后 BrowserView 仍可被重新挂载。
        dialog.tabIds = [];
        try {
          dialog.hide();
        } catch (error) {
          // BrowserWindow 关闭/BrowserView 销毁期间 hide 可能抛错;至少移除
          // 可见视图,避免权限异常把 UI 卡在页面上。
          console.error('[permissions] failed to hide dialog after result', {
            dialogId: dialog.id,
            error: error instanceof Error ? error.message : error,
          });
          try {
            browserWindow.removeBrowserView(dialog.browserView);
          } catch {
            // window 已销毁时无需再次处理
          }
        }
      }
    };

    dialog = Application.instance.dialogs.show({
      name: 'permissions',
      browserWindow,
      getBounds: () => {
        if (!externalNavigation) {
          const area = getAppContentBounds(browserWindow, appWindow);
          return {
            width: DIALOG_WIDTH,
            height: DIALOG_HEIGHT,
            x: area.x,
            y: area.y,
          };
        }

        const area = getAppContentBounds(browserWindow, appWindow);
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

    dialog.on('result', (_e: Electron.IpcMainEvent, result: any) => {
      try {
        if (typeof result === 'boolean') {
          settle({allowed: result, remember: true});
        } else {
          settle({
            allowed: Boolean(result?.allowed),
            remember: Boolean(result?.remember),
          });
        }
      } catch (error) {
        // IPC 结果异常时也必须结算并关闭,否则 Chromium 和 UI 都会一直等待。
        console.error('[permissions] invalid dialog result, denying request', {
          dialogId: dialog.id,
          error: error instanceof Error ? error.message : error,
        });
        settle({allowed: false, remember: false});
      }
    });
  });
};
