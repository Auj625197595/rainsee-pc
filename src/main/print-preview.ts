import { BrowserWindow, WebContents } from 'electron';
import {
  createPrintPreviewUrl,
  releasePrintPreviewUrl,
} from './models/protocol';

/**
 * 使用 Chromium 内置 PDF 阅读器展示打印结果。Electron 没有 Chrome 的打印设置
 * WebUI，这个独立窗口提供打印前的分页、缩放、下载及打印入口，同时不会触发
 * file:// PDF 被 KoodoReader 接管的导航规则。
 */
export const showPrintPreview = (source: WebContents, pdf: Buffer) => {
  const url = createPrintPreviewUrl(pdf);
  const parent = BrowserWindow.fromWebContents(source) || undefined;
  const preview = new BrowserWindow({
    parent,
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 540,
    title: '打印预览',
    autoHideMenuBar: true,
    backgroundColor: '#525659',
    webPreferences: {
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  preview.setMenuBarVisibility(false);
  preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  preview.on('closed', () => releasePrintPreviewUrl(url));
  preview.loadURL(url).catch((error) => {
    console.error('[print-preview] failed to load PDF:', error);
    if (!preview.isDestroyed()) preview.close();
  });
};
