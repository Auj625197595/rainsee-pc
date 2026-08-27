import { ipcMain } from 'electron';

import { getWebUIURL } from '~/common/webui';
import { Application } from '../application';

export interface SearchAnnotatorItemInput {
  position: number;
  title: string;
  url: string;
  introduction: string;
  className?: string;
}

export interface SearchAnnotatorAnalyzePayload {
  query: string;
  engine?: string;
  pageUrl?: string;
  items: SearchAnnotatorItemInput[];
}

export interface SearchAnnotatorResultItem {
  position: number;
  score: number;
  reason: string;
}

// 开源版不包含云端 AI 搜索标注与 AI 标签分组：
// 保持 IPC 契约存在但功能空置，注入函数为空操作，
// 避免删除通道导致渲染层残留调用抛出未处理异常。

export const injectSearchAnnotator = async (
  _webContents: Electron.WebContents,
) => {
  // 开源版禁用搜索结果标注注入
};

export const setupSearchAnnotatorIpc = () => {
  ipcMain.removeHandler('search-annotator-analyze');
  ipcMain.handle('search-annotator-analyze', async () => {
    return {
      query: '',
      answer: '',
      items: [],
      degraded: true,
    };
  });

  ipcMain.removeHandler('tab-organizer-ai-group');
  ipcMain.handle('tab-organizer-ai-group', async () => {
    return { groups: [], degraded: true };
  });

  // 气泡右上角齿轮:在当前窗口新建标签页打开 设置-地址栏。
  ipcMain.removeHandler('search-annotator-open-settings');
  ipcMain.handle('search-annotator-open-settings', async () => {
    const appWindow = Application.instance.windows.current;
    if (!appWindow) {
      return false;
    }

    appWindow.viewManager.create({
      url: `${getWebUIURL('settings')}?section=address-bar`,
      active: true,
    });
    return true;
  });
};
