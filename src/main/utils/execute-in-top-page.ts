// 在页面顶层执行一段 JS 的共享工具:优先 webContents.executeJavaScript,
// chrome-extension:// 顶层页在部分 Electron 沙箱路径下 webContents 级执行会卡死/失败,
// 此时回退到 mainFrame.executeJavaScript。
//
// 从 services/translate.ts 抽出公共,供「网页翻译引导注入」与「网页暗色模式(Dark Reader)
// 注入」共用,避免两份实现漂移。

export type ExecuteTarget = Pick<
  Electron.WebContents,
  'isDestroyed' | 'getURL' | 'executeJavaScript'
> & {
  mainFrame?: {
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<any>;
  };
};

export const executeInTopPage = async (
  target: ExecuteTarget,
  code: string,
  userGesture = true,
): Promise<any> => {
  if (!target || target.isDestroyed()) return undefined;

  const url = (() => {
    try {
      return target.getURL() || '';
    } catch {
      return '';
    }
  })();

  const useMainFrame = /^chrome-extension:\/\//i.test(url);
  const mainFrameExec = target.mainFrame?.executeJavaScript;

  if (useMainFrame && typeof mainFrameExec === 'function') {
    return mainFrameExec.call(target.mainFrame, code, userGesture);
  }

  try {
    return await target.executeJavaScript(code, userGesture);
  } catch (error) {
    if (typeof mainFrameExec === 'function') {
      return mainFrameExec.call(target.mainFrame, code, userGesture);
    }
    throw error;
  }
};

// 优先 mainFrame.executeJavaScript,mainFrame 不可用或抛错再退 webContents.executeJavaScript。
// 与 executeInTopPage 的区别:executeInTopPage 仅对 chrome-extension:// 用 mainFrame,普通页
// 优先 webContents——但 webContents.executeJavaScript 在部分页面(zhso.org 等 SPA、某些沙箱页)
// 会**挂死不抛错**,导致 fallback 永不触发(executeInTopPage 的 catch 拿不到控制权)。
// mainFrame(WebFrameMain)走另一条注入路径,在这些页面可靠。故还原翻译(revert)等
// "必须在用户点击显示原文后立即执行"的操作用本函数;runTranslate 内的 exec 也用同款优先策略。
export const execInPagePreferMainFrame = async (
  target: ExecuteTarget,
  code: string,
  userGesture = true,
): Promise<any> => {
  if (!target || target.isDestroyed()) return undefined;
  const mainFrameExec = target.mainFrame?.executeJavaScript;
  if (typeof mainFrameExec === 'function') {
    try {
      return await mainFrameExec.call(target.mainFrame, code, userGesture);
    } catch {
      // mainFrame 抛错再退 webContents(极端兼容情况)
    }
  }
  return target.executeJavaScript(code, userGesture);
};
