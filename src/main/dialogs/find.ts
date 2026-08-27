import { VIEW_Y_OFFSET } from '~/constants/design';
import { BrowserWindow } from 'electron';
import { Application } from '../application';

export const showFindDialog = (browserWindow: BrowserWindow) => {
  const appWindow =
    Application.instance.windows.fromBrowserWindow(browserWindow);

  // 动态弹窗在可见期间一直留在 dialogs 列表里,据此判断「搜索框是否已开启」。
  // dialogs.show 对已存在的弹窗只重新挂载视图、不聚焦输入框;而 find 弹窗
  // hideOnBlur:false,点页面后失焦但仍可见,再次按 Ctrl+F 应重新聚焦(并选中
  // 已有文本,便于覆盖输入),而非保持失焦。
  const alreadyOpen = !!Application.instance.dialogs.getDynamic('find');

  const dialog = Application.instance.dialogs.show({
    name: 'find',
    browserWindow,
    devtools: false,
    getBounds: () => {
      // 对齐当前网页视口右上角,而不是整个窗口右边缘。这样在左/右侧边栏、
      // AI 面板或订阅面板打开时,搜索框仍贴着网页内容区的右侧。
      const contentBounds = appWindow.viewManager.contentBounds;
      const { width } = browserWindow.getContentBounds();
      const contentX = contentBounds?.x ?? 0;
      const contentWidth = contentBounds?.width ?? width;
      return {
        width: 416,
        height: 70,
        x: contentX + contentWidth - 416,
        y: contentBounds?.y ?? VIEW_Y_OFFSET,
      };
    },
    tabAssociation: {
      tabId: appWindow.viewManager.selectedId,
      getTabInfo: (tabId) => {
        const tab = appWindow.viewManager.views.get(tabId);
        return tab.findInfo;
      },
      setTabInfo: (tabId, info) => {
        const tab = appWindow.viewManager.views.get(tabId);
        tab.findInfo = info;
      },
    },
    onWindowBoundsUpdate: (disposition) => {
      if (disposition === 'resize') dialog.rearrange();
    },
  });

  // 新建的弹窗会在 dom-ready 时自动 focus(dialogs-service.ts),无需处理;
  // 只有已存在的弹窗(show 返回 null)才需要在此补一次聚焦 + 选中文本。
  if (alreadyOpen) {
    const wc = Application.instance.dialogs.getDynamic('find')?.browserView
      ?.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.focus();
      wc.send('refocus-find-input');
    }
  }
};
