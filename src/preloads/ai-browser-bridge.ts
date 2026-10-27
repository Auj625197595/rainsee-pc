// window.rainseeBrowser:雨见AI 页面专用的浏览器桥。AI 面板 preload 与普通标签
// preload 共用此实现。只在官方主机注入(开发态额外放行 localhost,主进程仍会按
// 打包状态与 RAINSEE_AI_BASE 二次校验 sender,页面侧注入不是安全边界)。

import { BROWSER_TOOLS_PROTOCOL } from '~/common/browser-tools/protocol';

interface IpcLike {
  invoke(channel: string, ...args: any[]): Promise<any>;
  send(channel: string, ...args: any[]): void;
  on(channel: string, listener: (...args: any[]) => void): unknown;
}

const isAiHost = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'a.yjllq.com') return true;
    return url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

export const installAiBrowserBridge = (ipcRenderer: IpcLike, documentUrl: string) => {
  if (!isAiHost(documentUrl)) return false;
  ipcRenderer.on('ai-browser-token-updated', (_event: unknown, token: string) => {
    window.dispatchEvent(
      new CustomEvent('rainsee-browser-account', {detail: token || ''}),
    );
  });
  Object.defineProperty(window, 'rainseeBrowser', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      getToken: () => ipcRenderer.invoke('ai-browser-get-token'),
      openLogin: () => ipcRenderer.send('ai-browser-open-login'),
      openPage: () => ipcRenderer.send('ai-browser-open-page'),
      getCurrentPageMarkdown: () =>
        ipcRenderer.invoke('ai-browser-get-current-page-markdown'),
      // 浏览器工具(MCP 风格):listTools → {protocol, platform, tools[]};
      // callTool(name, args) → {content[], isError?, structured?}。
      toolsProtocol: BROWSER_TOOLS_PROTOCOL,
      listTools: () => ipcRenderer.invoke('ai-browser-tools-list'),
      callTool: (name: string, args?: Record<string, unknown>) =>
        ipcRenderer.invoke('ai-browser-tools-call', name, args || {}),
    }),
  });
  return true;
};
