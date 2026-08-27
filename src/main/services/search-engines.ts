import { ipcMain } from 'electron';
import { Application } from '../application';

// 开源版无云端搜索引擎源，搜索关键词直接返回当前本地设置中的引擎表。
export const runSearchEnginesService = () => {
  // 设置页可主动触发一次同步（兼容原 IPC 契约）
  ipcMain.handle('sync-search-engines', async () => {
    return Application.instance.settings.object.searchEngines;
  });
};
