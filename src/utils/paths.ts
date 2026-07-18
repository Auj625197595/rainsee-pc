// 注意:不要在顶层 import/require 'electron' 或 'path'。webpack 会把它们降成同步
// require(...),而本模块经 `~/utils`(utils/index.ts `export * from './paths'`)会进入
// nodeIntegration:false 的 WebUI(设置页等)。沙箱渲染进程里 require 未定义,模块
// 一求值就抛 "require is not defined" 致整个页面白屏。所有 Node/Electron 访问必须
// 延迟到 getPath() 函数体内(渲染进程从不调用 getPath,故永远不触发)。参考
// constants/settings.ts 的 getDefaultDownloadsPath 同款写法。
export const getPath = (...relativePaths: string[]) => {
  let electron: any;
  try {
    electron = require('electron');
  } catch {
    // 沙箱渲染进程无 require → 直接返回 null(渲染进程本就不该调用 getPath)。
    return null;
  }

  const app = electron && (electron.remote?.app || electron.app);
  if (!app || typeof app.getPath !== 'function') {
    return null;
  }

  let resolveFn: (dir: string, ...sub: string[]) => string;
  try {
    resolveFn = require('path').resolve;
  } catch {
    return null;
  }

  const dir = app.getPath('userData');
  return resolveFn(dir, ...relativePaths).replace(/\\/g, '/');
};
