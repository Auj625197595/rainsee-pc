import { ipcRenderer } from 'electron';

import store from '../store';

// 双引擎搜索:搜索触发时通知主进程在当前标签右侧加载副引擎(移动端 UA)。
// 主进程据 settings.dualEngineSearch 决定是否真正显示,故这里无条件发送即可。
// query 为原始搜索词(未编码)。仅搜索场景调用,普通 URL 导航不要调。
export const notifyDualEngineSearch = (query: string) => {
  if (!query) return;
  ipcRenderer.send(`dual-engine-search-${store.windowId}`, query);
};
