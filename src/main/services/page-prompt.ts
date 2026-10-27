import {app, BrowserWindow, ipcMain} from 'electron';
import type {WebContents} from 'electron';
import {randomUUID} from 'crypto';
import {join} from 'path';

export interface PagePromptOptions {
  parent: BrowserWindow;
  owner: WebContents;
  title: string;
  message: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  dark: boolean;
  /** Override used by the standalone Electron smoke test. */
  preloadPath?: string;
}

const PAGE_PROMPT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
        background: #ffffff;
        color: #202124;
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        background: #292a2d;
        color: #f1f3f4;
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        display: none;
        padding: 22px 24px 18px;
        background: inherit;
        color: inherit;
      }
      body[data-ready="true"] {
        display: flex;
        flex-direction: column;
      }
      #message {
        min-height: 42px;
        max-height: 78px;
        margin: 0 0 16px;
        overflow: auto;
        font-size: 14px;
        line-height: 21px;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }
      #value {
        width: 100%;
        height: 34px;
        padding: 5px 9px;
        border: 1px solid #9aa0a6;
        border-radius: 4px;
        outline: none;
        background: #ffffff;
        color: #202124;
        font: inherit;
      }
      #value:focus {
        border-color: #1a73e8;
        box-shadow: 0 0 0 1px #1a73e8;
      }
      :root[data-theme="dark"] #value {
        border-color: #70757a;
        background: #202124;
        color: #f1f3f4;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 18px;
      }
      button {
        min-width: 76px;
        height: 32px;
        padding: 0 16px;
        border: 1px solid #dadce0;
        border-radius: 4px;
        background: #ffffff;
        color: #3c4043;
        font: inherit;
        cursor: pointer;
      }
      button:hover { background: #f8f9fa; }
      button:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }
      #confirm {
        border-color: #1a73e8;
        background: #1a73e8;
        color: #ffffff;
      }
      #confirm:hover { background: #1765cc; }
      :root[data-theme="dark"] button {
        border-color: #5f6368;
        background: #292a2d;
        color: #e8eaed;
      }
      :root[data-theme="dark"] button:hover { background: #35363a; }
      :root[data-theme="dark"] #confirm {
        border-color: #8ab4f8;
        background: #8ab4f8;
        color: #202124;
      }
      :root[data-theme="dark"] #confirm:hover { background: #aecbfa; }
    </style>
  </head>
  <body>
    <form id="form">
      <p id="message"></p>
      <input id="value" type="text" autocomplete="off" aria-labelledby="message">
      <div class="actions">
        <button id="cancel" type="button"></button>
        <button id="confirm" type="submit"></button>
      </div>
    </form>
  </body>
</html>`;

/**
 * Show a separate-renderer modal so the calling page can remain blocked in
 * ipcRenderer.sendSync while the prompt UI continues processing input.
 */
export const showPagePrompt = (options: PagePromptOptions) =>
  new Promise<string | null>((resolve) => {
    if (options.parent.isDestroyed() || options.owner.isDestroyed()) {
      resolve(null);
      return;
    }

    const requestId = randomUUID();
    const resultChannel = `page-prompt-result-${requestId}`;
    const promptWindow = new BrowserWindow({
      width: 440,
      height: 250,
      parent: options.parent,
      modal: true,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: options.dark ? '#292a2d' : '#ffffff',
      webPreferences: {
        preload:
          options.preloadPath ||
          join(app.getAppPath(), 'build', 'page-prompt-preload.bundle.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
        partition: 'page-prompt',
        additionalArguments: [`--rainsee-page-prompt-id=${requestId}`],
      },
    });

    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(resultChannel, onResult);
      options.owner.removeListener('destroyed', onOwnerDestroyed);
      if (!promptWindow.isDestroyed()) promptWindow.destroy();
      resolve(value);
    };
    const onResult = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender.id !== promptWindow.webContents.id) return;
      settle(typeof value === 'string' ? value : null);
    };
    const onOwnerDestroyed = () => settle(null);

    ipcMain.on(resultChannel, onResult);
    options.owner.once('destroyed', onOwnerDestroyed);
    promptWindow.once('closed', () => settle(null));
    promptWindow.webContents.once('did-fail-load', () => settle(null));
    promptWindow.webContents.once('did-finish-load', () => {
      if (promptWindow.isDestroyed()) return;
      promptWindow.setTitle(options.title);
      promptWindow.webContents.send('page-prompt-init', {
        message: options.message,
        defaultValue: options.defaultValue,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        dark: options.dark,
      });
      promptWindow.show();
    });

    void promptWindow
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(PAGE_PROMPT_HTML)}`,
      )
      .catch(() => settle(null));
  });
