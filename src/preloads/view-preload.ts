import {clipboard, contextBridge, ipcRenderer, nativeImage, shell, webFrame, webUtils} from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import AutoComplete from './models/auto-complete';
import {getTheme} from '~/utils/themes';
import {ERROR_PROTOCOL, WEBUI_BASE_URL} from '~/constants/files';
import './selection-translate';

const tabId = ipcRenderer.sendSync('get-webcontents-id');

export const windowId: number = ipcRenderer.sendSync('get-window-id');

// 网页里的 window.close() 应关闭当前标签，而不是关闭承载 BrowserView 的
// 主 BrowserWindow。必须在页面脚本执行前改写；main 端会按 e.sender.id
// 反查真实标签，网页无法伪造其它标签 id。
window.close = () => {
  ipcRenderer.send('web-page-window-close');
};

const electronRenderer = {
  clipboard,
  ipcRenderer,
  nativeImage,
  shell,
  webFrame,
  webUtils,
};

const searchAnnotatorAnalyze = (payload: any) =>
  ipcRenderer.invoke('search-annotator-analyze', payload);

// 搜索标注气泡右上角齿轮 → 打开 设置-地址栏。
const searchAnnotatorOpenSettings = () =>
  ipcRenderer.invoke('search-annotator-open-settings');

const canExposeNodeModules = (url: string) =>
  url.startsWith('yjllq://web.koodoreader.com/');

const canExposeRequire = (url: string) =>
  canExposeNodeModules(url) ||
  url.startsWith(WEBUI_BASE_URL) ||
  url === 'about:blank' ||
  url.startsWith(`${ERROR_PROTOCOL}:`);

// 内置页打包后仍会通过 require('electron') 取用桥接能力；
// koodoreader 额外需要 window.require('fs'/'path') 读取外部 PDF。
// 为避免影响普通站点的环境探测,仅对受信任页面挂载 window.require。
const requireShim = (id: string) => {
  if (id === 'electron') {
    return electronRenderer;
  }

  const currentUrl = window.location.href;
  if (canExposeNodeModules(currentUrl)) {
    if (id === 'fs') return fs;
    if (id === 'path') return path;
  }

  return undefined;
};

if (canExposeRequire(window.location.href)) {
  try {
    contextBridge.exposeInMainWorld('require', requireShim);
  } catch (_) {
    (window as any).require = requireShim;
  }
}
(window as any).electron = electronRenderer;
(window as any).getPathForFile = (file: File) => webUtils.getPathForFile(file);
(window as any).searchAnnotatorAnalyze = searchAnnotatorAnalyze;
(window as any).searchAnnotatorOpenSettings = searchAnnotatorOpenSettings;
// 内置页(webui)需按窗口发 IPC(如书签管理器跑 bookmarklet 时的 add-tab-${windowId});
// 仅对受信任内部页暴露,外部站点不暴露。
if (canExposeRequire(window.location.href)) {
  (window as any).windowId = windowId;
}

let lastChromeHoverClear = 0;
const clearChromeTabHover = () => {
  const now = Date.now();
  if (now - lastChromeHoverClear < 120) return;
  lastChromeHoverClear = now;
  ipcRenderer.send('view-clear-tab-hover', tabId);
};

window.addEventListener('mouseenter', clearChromeTabHover, true);
window.addEventListener('mousemove', clearChromeTabHover, true);
window.addEventListener('pointermove', clearChromeTabHover, true);

const crxStripUncloneable = (val: any, seen?: WeakSet<any>): any => {
  const t = typeof val;
  if (val == null) return val;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return val;
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = {__crxBlob: true, type: val.type || '', size: val.size || 0};
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          out[key] = crxStripUncloneable(desc.value, seen);
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
    if (typeof File !== 'undefined' && val instanceof File) {
      const out: any = {
        __crxFile: true,
        type: val.type || '',
        size: val.size || 0,
        name: val.name || '',
      };
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          out[key] = crxStripUncloneable(desc.value, seen);
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
  } catch (_) {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>();
  if (seen.has(val)) return null;
  try {
    seen.add(val);
  } catch (_) {
    // best-effort
  }
  if (Array.isArray(val)) {
    return val.map((item) => crxStripUncloneable(item, seen));
  }
  const out: any = {};
  for (const key of Object.keys(val)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
      out[key] = crxStripUncloneable(desc.value, seen);
    } catch (_) {
      // best-effort
    }
  }
  return out;
};

const crxBlobToDataUrl = (blob: Blob): Promise<string | undefined> =>
  new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.onabort = () => resolve(undefined);
      reader.readAsDataURL(blob);
    } catch (_) {
      resolve(undefined);
    }
  });

const crxStripPortMessage = async (val: any, seen?: WeakSet<any>): Promise<any> => {
  const t = typeof val;
  if (val == null) return val;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return val;
  try {
    if (typeof Blob !== 'undefined' && val instanceof Blob) {
      const out: any = {__crxBlob: true, type: val.type || '', size: val.size || 0};
      if (typeof File !== 'undefined' && val instanceof File) {
        out.__crxFile = true;
        out.name = val.name || '';
      }
      const dataUrl = await crxBlobToDataUrl(val);
      if (dataUrl) {
        out.imageDataUrl = dataUrl;
        out.dataUrl = dataUrl;
      }
      for (const key of Object.keys(val)) {
        try {
          const desc = Object.getOwnPropertyDescriptor(val, key);
          if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
          const stripped = await crxStripPortMessage(desc.value, seen);
          if (stripped !== undefined || !(key in out)) out[key] = stripped;
        } catch (_) {
          // best-effort
        }
      }
      return out;
    }
  } catch (_) {
    // best-effort
  }
  if (!seen) seen = new WeakSet<any>();
  if (seen.has(val)) return null;
  try {
    seen.add(val);
  } catch (_) {
    // best-effort
  }
  if (Array.isArray(val)) {
    const arr: any[] = [];
    for (const item of val) arr.push(await crxStripPortMessage(item, seen));
    return arr;
  }
  const out: any = {};
  for (const key of Object.keys(val)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') continue;
      const stripped = await crxStripPortMessage(desc.value, seen);
      if (stripped !== undefined) out[key] = stripped;
    } catch (_) {
      // best-effort
    }
  }
  return out;
};

const crxSendPortMessage = (
  channel: 'crx-port-post' | 'crx-port-post-from-owner',
  portId: string,
  message: any,
) => {
  crxStripPortMessage(message)
    .then((stripped) => ipcRenderer.send(channel, portId, stripped))
    .catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] ${channel} strip failed`, err);
      } catch (_) {
        // best-effort
      }
      try {
        ipcRenderer.send(channel, portId, crxStripUncloneable(message));
      } catch (_) {
        // best-effort
      }
    });
};

const crxSendCloneSafe = (channel: string, ...args: any[]) => {
  Promise.all(args.map((arg) => crxStripPortMessage(arg)))
    .then((stripped) => ipcRenderer.send(channel, ...stripped))
    .catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] ${channel} strip failed`, err);
      } catch (_) {
        // best-effort
      }
      try {
        ipcRenderer.send(channel, ...args.map((arg) => crxStripUncloneable(arg)));
      } catch (_) {
        // best-effort
      }
    });
};

const crxMsgBrief = (message: any): string => {
  try {
    if (message == null || typeof message !== 'object') return String(message);
    const parts: string[] = [];
    for (const key of ['id', 'type', 'method', 'name', 'target']) {
      const val = message[key];
      if (val != null && typeof val !== 'object') parts.push(`${key}=${String(val)}`);
    }
    const inner = message.message;
    if (inner && typeof inner === 'object') {
      for (const key of ['id', 'type', 'method', 'name', 'target']) {
        const val = inner[key];
        if (val != null && typeof val !== 'object') parts.push(`message.${key}=${String(val)}`);
      }
    }
    return parts.length ? parts.join(' ') : `keys=${Object.keys(message).slice(0, 8).join(',')}`;
  } catch (_) {
    return typeof message;
  }
};

const crxRespBrief = (response: any): string => {
  try {
    if (response === undefined) return 'undefined';
    if (response === null) return 'null';
    if (typeof response !== 'object') return `${typeof response}:${String(response).slice(0, 80)}`;
    if (Array.isArray(response)) return `array(${response.length})`;
    return `object keys=${Object.keys(response).slice(0, 8).join(',')}`;
  } catch (_) {
    return typeof response;
  }
};

type CrxPendingTransfer = {
  resolve: (response: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

const crxPendingTransferResponses = new Map<string, CrxPendingTransfer>();

const crxMaybeTransferResponse = (message: any) => {
  try {
    const transfer = message && typeof message === 'object' ? message.transfer : null;
    if (!transfer || transfer.type !== 'response' || !transfer.id) return false;
    const pending = crxPendingTransferResponses.get(String(transfer.id));
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] transfer response id=${transfer.id} pending=${!!pending} ` +
          `dataKeys=${
            transfer.data && typeof transfer.data === 'object'
              ? Object.keys(transfer.data).slice(0, 8).join(',')
              : ''
          } imageLen=${
            transfer.data && typeof transfer.data.imageDataUrl === 'string'
              ? transfer.data.imageDataUrl.length
              : ''
          }`,
      );
    } catch (_) {
      // best-effort
    }
    if (!pending) return false;
    crxPendingTransferResponses.delete(String(transfer.id));
    clearTimeout(pending.timer);
    setTimeout(() => pending.resolve(undefined), 0);
    return true;
  } catch (_) {
    return false;
  }
};

const crxWaitForTransferResponse = (transfer: any): Promise<any> =>
  new Promise((resolve) => {
    const key = String(transfer.id);
    const old = crxPendingTransferResponses.get(key);
    if (old) {
      clearTimeout(old.timer);
      crxPendingTransferResponses.delete(key);
    }
    const timer = setTimeout(() => {
      crxPendingTransferResponses.delete(key);
      try {
        // eslint-disable-next-line no-console
        console.warn(`[crx-view] transfer wait timeout id=${key}`);
      } catch (_) {
        // best-effort
      }
      resolve(undefined);
    }, 30000);
    try {
      // eslint-disable-next-line no-console
      console.warn(`[crx-view] transfer wait add id=${key}`);
    } catch (_) {
      // best-effort
    }
    crxPendingTransferResponses.set(key, {resolve, timer});
  });

// koodoreader 外部文件直开:让阅读器认为运行在 Electron 桌面环境,
// 从而 fetchBook 走 window.require('fs') 分支按 book.path 读本地文件。
// book 对象的构造(含 format/path)已在 koodo-reader 源码的
// reader/component.tsx 里按 ?filePath 完成,这里只负责环境标记。
try {
  const currentUrl = window.location.href;
  if (currentUrl.startsWith('yjllq://web.koodoreader.com/')) {
    // react-device-detect 的 isElectron 三条路径全设,确保判定为 true:
    //   1) window.process.type === 'renderer'
    //   2) process.versions.electron
    //   3) navigator.userAgent 含 "Electron"
    try {
      const wProc = (window as any).process;
      if (wProc && typeof wProc === 'object') {
        wProc.type = 'renderer';
        wProc.versions = wProc.versions || {};
        wProc.versions.electron = '42.0.0';
      } else {
        (window as any).process = {type: 'renderer', versions: {electron: '42.0.0'}};
      }
    } catch (_) {
      // best-effort
    }

    try {
      const originalUA = navigator.userAgent;
      const electronUA = originalUA.includes('Electron')
        ? originalUA
        : `${originalUA} Electron/42.0.0`;
      Object.defineProperty(navigator, 'userAgent', {
        value: electronUA,
        configurable: true,
      });
    } catch (_) {
      // 某些情况下 userAgent 不可覆盖,忽略(已有 process.type 兜底)
    }
  }
} catch (e) {
  console.warn('[koodo-preload] failed:', e);
}

// Surface any unhandled promise/IPC rejections (e.g. "An object could not be
// cloned") with their reason + stack, so a failing dessant image-transfer call
// can be pinpointed instead of disappearing silently.
try {
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r: any = (ev && (ev as any).reason) || {};
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] UNHANDLED REJECTION: ${(r && r.message) || r} :: ${(r && r.stack) || ''}`,
      );
    } catch (_) {
      // best-effort
    }
  });
} catch (_) {
  // best-effort
}

// Content->view delivery for embedded extension view iframes (e.g. dessant
// search-by-image select/confirm view, a chrome-extension:// frame in the page).
// The view normally receives openView/closeView over a tabs.connect Port, but
// that Port only reaches dynamic (main-world) content scripts; this extension's
// content script is declarative (isolated world), so the Port never fires and
// the view's overlay (gated on openView) never shows. The view's shim announces
// itself here (__crxViewAnnounce) and installs a fake Port fed by
// __crxViewOpenView. We capture the iframe's contentWindow via event.source and
// re-broadcast openView/closeView/messageView to it. Queue until announced
// (openView can arrive before the view finishes loading).
let __crxViewWin: any = null;
let __crxViewQ: any[] = [];
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (d && d.__crxViewAnnounce) {
    __crxViewWin = (ev as any).source;
    const q = __crxViewQ;
    __crxViewQ = [];
    for (const m of q) {
      try {
        __crxViewWin.postMessage({__crxViewOpenView: true, msg: m}, '*');
      } catch (_) {
        // best-effort
      }
    }
  }
});

// Re-broadcast SW/popup-originated tabs.sendMessage (main-world IPC
// 'crx-cs-message', sent by messaging.ts sendMessageToTab) onto the page window
// so the ISOLATED-world declarative content script can receive it. Electron's
// native SW->content-script dispatch does NOT deliver to BrowserView tabs in
// this build, and 'crx-cs-message' itself is delivered to the page MAIN world
// only; the content-script shim (extension-storage-patch.ts SHIM_BODY) listens
// for this re-broadcast and fires chrome.runtime.onMessage. window.postMessage
// is shared across the content-script isolated world and the page main world.

// The view's onMessage switches on the INNER message id (e.g.
// `imageSelectionSubmit`), but the background delivers view-bound payloads
// wrapped in a `messageView` envelope (`{id:"messageView", message:{...},
// flattenMessage:true}`). The content module normally unwraps that envelope in
// its route handler before forwarding the inner message to the view over the
// tabs.connect Port. Here that Port is dead (the shim installs a fake Port fed
// by __crxViewOpenView), so this bridge is the ONLY content->view path — we must
// unwrap the envelope ourselves so the view receives the inner id it expects.
const unwrapMessageView = (message: any): any => {
  if (!message || message.id !== 'messageView') return message;
  const inner: any = {...(message.message || {})};
  if (message.flattenMessage) {
    const env: any = {...message};
    delete env.id;
    delete env.message;
    delete env.flattenMessage;
    Object.assign(inner, env);
  }
  return inner;
};

ipcRenderer.on('crx-cs-message', (_e, messageId, message, sender) => {
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[crx-view] cs-message recv id=${messageId} ext=${
        sender && sender.id
      } url=${location.href} msg=${crxMsgBrief(message)}`,
    );
  } catch (_) {
    // best-effort
  }
  try {
    window.postMessage(
      {
        __crxCsFwd: true,
        messageId,
        extensionId: sender && sender.id,
        message,
        sender: sender || {},
      },
      '*',
    );
  } catch (_) {
    // best-effort; never break the page on a forward failure
  }
  if (
    message &&
    (message.id === 'openView' ||
      message.id === 'closeView' ||
      message.id === 'messageView')
  ) {
    const viewMsg = unwrapMessageView(message);
    if (__crxViewWin) {
      try {
        __crxViewWin.postMessage({__crxViewOpenView: true, msg: viewMsg}, '*');
      } catch (_) {
        // best-effort
      }
    } else {
      __crxViewQ.push(viewMsg);
    }
  }
});

// SW->content Port bridge for DECLARATIVE content scripts (dessant engine in
// the isolated world). dessant's image storageRequest uses transferResponse:
// true, so the SW opens a transfer Port via tabs.connect(name=transferId) and
// posts the image over it. connectToTab delivers 'crx-runtime.onConnect' +
// 'crx-port-post:<portId>' to this webContents, but crx-preload (renderer/
// index.ts) only catches them in the MAIN world — this extension's content
// script runs in the ISOLATED world whose chrome.runtime.onConnect never fires,
// so NI() resolves with the empty-array fallback and h() crashes on
// imageDataUrl.split. Relay the onConnect event + each port message to the
// isolated world via window.postMessage (shared across worlds); the SHIM
// (extension-storage-patch.ts) synthesizes a fake runtime.onConnect + fake
// Port. Reverse direction (engine port.postMessage) returns as
// __crxSwPortPostBack and is forwarded over the real 'crx-port-post' IPC.
// No accept-handshake needed: connectToTab sets swReady=true, and the main
// process never buffers SW->frame port messages.
ipcRenderer.on('crx-runtime.onConnect', (_e, payload: any) => {
  const portId = payload && payload.portId;
  const name = (payload && payload.name) || '';
  const sender = (payload && payload.sender) || {};
  if (!portId) return;
  const chan = `crx-port-post-to-frame:${portId}`;
  const legacyChan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_ee: any, message: any) => {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] sw-port forward portId=${portId} msg=${crxMsgBrief(message)}`,
      );
    } catch (_) {
      // best-effort
    }
    try {
      window.postMessage({__crxSwPortPost: true, portId, message}, '*');
    } catch (_) {
      // best-effort
    }
    crxMaybeTransferResponse(message);
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch (_) {
      // best-effort
    }
    try {
      ipcRenderer.off(legacyChan, onMsg);
    } catch (_) {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch (_) {
      // best-effort
    }
    try {
      window.postMessage({__crxSwPortDisconnect: true, portId}, '*');
    } catch (_) {
      // best-effort
    }
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.on(legacyChan, onMsg);
  ipcRenderer.once(disChan, onDis);
  try {
    // eslint-disable-next-line no-console
    console.warn(`[crx-view] sw-port connect portId=${portId} name=${name}`);
  } catch (_) {
    // best-effort
  }
  try {
    window.postMessage({__crxSwConnect: true, portId, name, sender}, '*');
  } catch (_) {
    // best-effort
  }
});
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxCsFwdResp && d.messageId) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] cs-message response id=${d.messageId} response=${crxRespBrief(d.response)}`,
      );
    } catch (_) {
      // best-effort
    }
    crxSendCloneSafe('crx-cs-message-response', d.messageId, d.response);
    return;
  }
  if (d.__crxSwPortPostBack && d.portId) {
    // isolated-world engine port.postMessage -> SW (frame->SW direction).
    crxSendPortMessage('crx-port-post', d.portId, d.message);
  } else if (d.__crxSwPortDisconnectBack && d.portId) {
    try {
      ipcRenderer.send('crx-port-disconnect', d.portId);
    } catch (_) {
      // best-effort
    }
  }
});

// Content->background runtime.sendMessage bridge — the REVERSE of the CS receive
// bridge above. Declarative content scripts (isolated world) call
// chrome.runtime.sendMessage to reach the SW, but native content->SW delivery is
// unreliable for BrowserView tabs (dessant's image-select pointerup
// routeMessage never arrives). The content-script shim overrides
// chrome.runtime.sendMessage to post __crxCsSend here; we invoke the vendor's
// 'crx-runtime-message' handler (messaging.ts onRuntimeMessage — the same path
// dynamic content scripts use) and relay the response back by mid. window.postMessage
// is shared across the content-script isolated world and this main/preload world.
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxCsSend) return;
  const source: any = (ev as any).source || window;
  const transfer = d.message && typeof d.message === 'object' ? d.message.transfer : null;
  const transferWait =
    transfer && transfer.transferResponse && transfer.id
      ? crxWaitForTransferResponse(transfer)
      : null;
  try {
    if (transferWait) {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] cs-send transfer wait mid=${d.mid} id=${transfer.id} ` +
          `msgKeys=${Object.keys(d.message || {}).slice(0, 8).join(',')}`,
      );
    }
  } catch (_) {
    // best-effort
  }
  let response: any;
  try {
    response = await ipcRenderer.invoke('crx-runtime-message', d.extId, d.message);
    if (transferWait && (response === undefined || response === null)) response = await transferWait;
    try {
      if (transferWait) {
        // eslint-disable-next-line no-console
        console.warn(
          `[crx-view] cs-send transfer result mid=${d.mid} id=${transfer.id} ` +
            `response=${crxRespBrief(response)}`,
        );
      }
    } catch (_) {
      // best-effort
    }
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] invoke FAIL id=${d.message && d.message.id} err=${err && (err as any).message}`,
      );
    } catch (_) {
      // best-effort
    }
    response = undefined;
  }
  try {
    source.postMessage({__crxCsSendResp: true, mid: d.mid, response}, '*');
  } catch (err) {
    // The response payload (e.g. an image with a Blob/non-cloneable member)
    // may fail structured clone across the world boundary.
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] resp postMessage FAIL id=${d.message && d.message.id} err=${err && (err as any).message}`,
      );
    } catch (_) {
      // best-effort
    }
  }
});

// Content->background runtime.connect Port bridge — the Port analogue of the
// __crxCsSend sendMessage bridge above. A content script's chrome.runtime.connect
// (overridden by the SHIM in the isolated world) posts __crxCSConnect here; we
// open a real Port via the vendor 'crx-port-connect' handler (messaging.ts
// onPortConnect -> SW 'crx-runtime.onConnect') and relay both directions by
// connId. Without this, an MV3 extension that registers its runtime.onMessage
// API dispatcher inside an onConnect handler (BewlyBewly: handleConnect ->
// onMessage.addListener(handleMessage)) never gets that dispatcher registered,
// because native content->SW connect never reaches the SW -> every content->SW
// sendMessage then resolves undefined. Outgoing posts are buffered until the
// (async) portId lands so connect()-then-postMessage() isn't lost.
const csConnMap = new Map<string, { portId: string; buf: any[] }>();
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxCSConnect) return;
  const source: any = (ev as any).source || window;
  const connId = d.connId;
  const extId = d.extId;
  const name = d.name || '';
  const entry = { portId: '', buf: [] as any[] };
  csConnMap.set(connId, entry);
  let portId = '';
  try {
    portId = await ipcRenderer.invoke('crx-port-connect', extId, { name });
  } catch {
    portId = '';
  }
  if (!portId) {
    csConnMap.delete(connId);
    try {
      source.postMessage({ __crxCSPortDisIn: true, connId }, '*');
    } catch {
      // best-effort
    }
    return;
  }
  entry.portId = portId;
  for (const m of entry.buf) {
    crxSendPortMessage('crx-port-post', portId, m);
  }
  entry.buf.length = 0;
  const chan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_e: any, message: any) => {
    try {
      source.postMessage({ __crxCSPortIn: true, connId, message }, '*');
    } catch {
      // best-effort
    }
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch {
      // best-effort
    }
    try {
      source.postMessage({ __crxCSPortDisIn: true, connId }, '*');
    } catch {
      // best-effort
    }
    csConnMap.delete(connId);
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.once(disChan, onDis);
  try {
    // eslint-disable-next-line no-console
    console.warn(`[crx-view] cs-port connect connId=${connId} portId=${portId} name=${name}`);
  } catch {
    // best-effort
  }
});
// Outgoing: content Port.postMessage / disconnect -> SW (buffered until portId).
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxCSPortOut && d.connId) {
    const entry = csConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      crxSendPortMessage('crx-port-post', entry.portId, d.message);
    } else {
      try {
        entry.buf.push(d.message);
      } catch {
        // best-effort
      }
    }
  } else if (d.__crxCSPortDisOut && d.connId) {
    const entry = csConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      try {
        ipcRenderer.send('crx-port-disconnect', entry.portId);
      } catch {
        // best-effort
      }
    }
    csConnMap.delete(d.connId);
  }
});

// Extension iframe -> content-script tabs.connect bridge. Some extensions open
// chrome-extension:// UI frames inside the web page and then call
// chrome.tabs.connect(activeTab.id, {name, frameId:0}) from that iframe. Electron
// may give that iframe a native/partial chrome.tabs where connect never reaches
// our vendor messaging hub. The frame-level bridge in view.ts posts
// __crxTabsConnect here; we invoke the same 'crx-msg' tabs.connect handler used
// by crx-preload and relay the resulting Port both ways.
const iframeTabConnMap = new Map<string, { portId: string; buf: any[] }>();
window.addEventListener('message', async (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d || !d.__crxTabsConnect) return;
  const source: any = (ev as any).source || window;
  const connId = d.connId;
  const extId = d.extId;
  const tabIdArg = typeof d.tabId === 'number' ? d.tabId : undefined;
  const info = {...(d.info || {}), __crxOwnerFrameBridge: true};
  const entry = { portId: '', buf: [] as any[] };
  iframeTabConnMap.set(connId, entry);
  let portId = '';
  try {
    portId = await ipcRenderer.invoke('crx-msg', extId, 'tabs.connect', tabIdArg, info);
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] iframe tabs.connect FAIL connId=${connId} ext=${extId} err=${
          err && (err as any).message
        }`,
      );
    } catch {
      // best-effort
    }
    portId = '';
  }
  if (!portId) {
    iframeTabConnMap.delete(connId);
    try {
      source.postMessage({__crxTabsPortDisIn: true, connId}, '*');
    } catch {
      // best-effort
    }
    return;
  }
  entry.portId = portId;
  for (const m of entry.buf) {
    crxSendPortMessage('crx-port-post-from-owner', portId, m);
  }
  entry.buf.length = 0;
  const chan = `crx-port-post-to-owner:${portId}`;
  const legacyChan = `crx-port-post:${portId}`;
  const disChan = `crx-port-disconnect:${portId}`;
  const onMsg = (_e: any, message: any) => {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[crx-view] iframe tabs.port recv connId=${connId} portId=${portId} msg=${crxMsgBrief(
          message,
        )}`,
      );
    } catch {
      // best-effort
    }
    try {
      source.postMessage({__crxTabsPortIn: true, connId, message}, '*');
    } catch {
      // best-effort
    }
  };
  const onDis = () => {
    try {
      ipcRenderer.off(chan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(legacyChan, onMsg);
    } catch {
      // best-effort
    }
    try {
      ipcRenderer.off(disChan, onDis);
    } catch {
      // best-effort
    }
    iframeTabConnMap.delete(connId);
    try {
      source.postMessage({__crxTabsPortDisIn: true, connId}, '*');
    } catch {
      // best-effort
    }
  };
  ipcRenderer.on(chan, onMsg);
  ipcRenderer.on(legacyChan, onMsg);
  ipcRenderer.once(disChan, onDis);
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[crx-view] iframe tabs.connect connId=${connId} portId=${portId} ext=${extId} ` +
        `tab=${tabIdArg ?? 'current'} name=${info && info.name}`,
    );
  } catch {
    // best-effort
  }
});
window.addEventListener('message', (ev: MessageEvent) => {
  const d = (ev && (ev as any).data) || null;
  if (!d) return;
  if (d.__crxTabsPortOut && d.connId) {
    const entry = iframeTabConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      crxSendPortMessage('crx-port-post-from-owner', entry.portId, d.message);
    } else {
      try {
        entry.buf.push(d.message);
      } catch {
        // best-effort
      }
    }
  } else if (d.__crxTabsPortDisOut && d.connId) {
    const entry = iframeTabConnMap.get(d.connId);
    if (!entry) return;
    if (entry.portId) {
      try {
        ipcRenderer.send('crx-port-disconnect-from-owner', entry.portId);
      } catch {
        // best-effort
      }
    }
    iframeTabConnMap.delete(d.connId);
  }
});

const goBack = () => {
  ipcRenderer.invoke(`web-contents-call`, {
    webContentsId: tabId,
    method: 'goBack',
  });
};

const goForward = () => {
  ipcRenderer.invoke(`web-contents-call`, {
    webContentsId: tabId,
    method: 'goForward',
  });
};

window.addEventListener('mouseup', (e) => {
  if (e.button === 3) {
    e.preventDefault();
    goBack();
  } else if (e.button === 4) {
    e.preventDefault();
    goForward();
  }
});

let beginningScrollLeft: number = null;
let beginningScrollRight: number = null;
let horizontalMouseMove = 0;
let verticalMouseMove = 0;

const resetCounters = () => {
  beginningScrollLeft = null;
  beginningScrollRight = null;
  horizontalMouseMove = 0;
  verticalMouseMove = 0;
};

function getScrollStartPoint(x: number, y: number) {
  let left = 0;
  let right = 0;

  let n = document.elementFromPoint(x, y);

  while (n) {
    if (n.scrollLeft !== undefined) {
      left = Math.max(left, n.scrollLeft);
      right = Math.max(right, n.scrollWidth - n.clientWidth - n.scrollLeft);
    }
    n = n.parentElement;
  }
  return {left, right};
}

document.addEventListener('wheel', (e) => {
  verticalMouseMove += e.deltaY;
  horizontalMouseMove += e.deltaX;

  if (beginningScrollLeft === null || beginningScrollRight === null) {
    const result = getScrollStartPoint(e.deltaX, e.deltaY);
    beginningScrollLeft = result.left;
    beginningScrollRight = result.right;
  }
});

ipcRenderer.on('scroll-touch-end', () => {
  if (
    horizontalMouseMove - beginningScrollRight > 150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollRight < 10) {
      goForward();
    }
  }

  if (
    horizontalMouseMove + beginningScrollLeft < -150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollLeft < 10) {
      goBack();
    }
  }

  resetCounters();
});

// [内存节省] 后台标签闲置超时后,主进程(tab-throttle 服务)发来此信号,让本帧释放
// 内存缓存(解码图片/字体/内存态资源)。不重载页面、不丢 DOM/滚动位/表单,仅清缓存,
// 是「轻量节流」下唯一能实际回收部分渲染进程内存的手段。webFrame.clearCache 只清内存
// 缓存,磁盘缓存保留,重新激活时开销极小。
ipcRenderer.on('tab-release-memory', () => {
  try {
    webFrame.clearCache();
  } catch {
    // best-effort;清缓存失败无副作用
  }
});

if (process.env.ENABLE_AUTOFILL) {
  window.addEventListener('load', AutoComplete.loadForms);
  window.addEventListener('mousedown', AutoComplete.onWindowMouseDown);
}

const postMsg = (data: any, res: any) => {
  window.postMessage(
    {
      id: data.id,
      result: res,
      type: 'result',
    },
    '*',
  );
};

let hostname = window.location.href.substr(WEBUI_BASE_URL.length);
window.addEventListener('DOMContentLoaded', () => {
  if (
    process.env.ENABLE_EXTENSIONS &&
    window.location.href.startsWith('https://microsoftedge.microsoft.com/addons')
  ) {
    const positions = document.getElementsByTagName('head')[0];
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://api.yjllq.com/static/js/crxdownload.js?t=11';
    positions.appendChild(script);
  }

  if (
    process.env.ENABLE_EXTENSIONS &&
    window.location.href.startsWith('https://chromewebstore.google.com')
  ) {
    const activatedButtons = new WeakSet<HTMLButtonElement>();
    const extensionIdPattern = /\/detail\/[^/]+\/([a-p]{32})(?:[/?#]|$)/i;
    const installButtonText = /^(添加至 Chrome|Add to Chrome)$/i;

    const activateInstallButton = () => {
      const extensionId = window.location.href.match(extensionIdPattern)?.[1];
      if (!extensionId) return;

      for (const button of Array.from(document.querySelectorAll('button'))) {
        const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!installButtonText.test(label)) continue;

        button.disabled = false;
        button.removeAttribute('disabled');
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');

        if (activatedButtons.has(button)) continue;
        activatedButtons.add(button);
        button.addEventListener(
          'click',
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();

            const currentExtensionId = window.location.href.match(
              extensionIdPattern,
            )?.[1];
            if (!currentExtensionId) return;

            const prodVersion = process.versions.chrome || '133.0.0.0';
            const updateValue = encodeURIComponent(
              `id=${currentExtensionId}&installsource=ondemand&uc`,
            );
            window.location.href =
              'https://clients2.google.com/service/update2/crx' +
              `?response=redirect&prodversion=${encodeURIComponent(
                prodVersion,
              )}` +
              `&acceptformat=crx2,crx3&x=${updateValue}`;
          },
          true,
        );
      }
    };

    activateInstallButton();
    new MutationObserver(activateInstallButton).observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      },
    );
  }
});

const settings = ipcRenderer.sendSync('get-settings-sync');
//console.log("preload", window.location.href, hostname);
if (window.location.href == "about:blank") {
  hostname = "newtab";
}
if (
  window.location.href.startsWith(WEBUI_BASE_URL) ||
  window.location.protocol === `${ERROR_PROTOCOL}:` ||
  window.location.href == "about:blank"
) {
  (async function () {
    const w = await webFrame.executeJavaScript('window');
    w.settings = settings;
    // 设备参数(ck/devid/prod/lang),供新标签页 iframe 拼接 pcapp.rainsee.cn 的 query 使用。
    w.deviceParams = ipcRenderer.sendSync('get-device-params');
    if (canExposeRequire(window.location.href)) {
      w.require = requireShim;
    }
    w.electron = electronRenderer;
    // With `sandbox: true` the nested `electron` object above does not expose
    // its methods across the world boundary, so pages can't call
    // `window.electron.ipcRenderer.invoke/send`. Plain functions do transfer
    // (same mechanism as `getHistory`/`getTopSites` below), so bridge the two
    // IPC primitives the webui pages actually need.
    w.ipcInvoke = (channel: string, ...args: any[]) =>
      ipcRenderer.invoke(channel, ...args);
    w.ipcSend = (channel: string, ...args: any[]) =>
      ipcRenderer.send(channel, ...args);
    w.getPathForFile = (file: File) => webUtils.getPathForFile(file);
    w['supervideo-app-version'] = process.env.VERSION_CODE;

    if (window.location.protocol === `${ERROR_PROTOCOL}:`) {
      w.theme = getTheme(w.settings.theme);
      w.errorURL = await ipcRenderer.invoke(`get-error-url-${tabId}`);
      // Wired to the error page's buttons. Exposed as top-level functions (not a
      // nested object) because, with `sandbox: true`, only plain functions
      // transfer to the page world — methods on a nested object are lost (same
      // reason ipcInvoke/ipcSend are bridged above).
      w.errorReload = () => {
        if (w.errorURL) window.location.replace(w.errorURL);
      };
      w.errorGoHome = () => {
        ipcRenderer.invoke(`web-contents-call`, {
          webContentsId: tabId,
          method: 'home',
        });
      };
      w.errorCheckNetwork = () => {
        ipcRenderer.invoke('check-network').catch(() => undefined);
      };
      w.errorIgnoreCertificateError = async () => {
        const res = await ipcRenderer.invoke(`ignore-certificate-error-${tabId}`);
        if (!res?.error) {
          if (w.errorURL) window.location.replace(w.errorURL);
          else window.location.reload();
        }
        return res;
      };
      w.errorAddAdblockWhitelist = async (domain?: string) => {
        let targetDomain = typeof domain === 'string' ? domain.trim() : '';
        if (!targetDomain && w.errorURL) {
          try {
            targetDomain = new URL(w.errorURL).hostname || '';
          } catch (e) {}
        }
        const res = await ipcRenderer.invoke('adblock-add-whitelist', targetDomain);
        if (!res?.error || res.error === '该域名已在白名单') {
          if (w.errorURL) window.location.replace(w.errorURL);
          else window.location.reload();
        }
        return res;
      };
    } else {
      w.getHistory = async () => {
        return await ipcRenderer.invoke(`history-get`);
      };
      w.cloudDownloadHistory = async () => {
        try {
          await ipcRenderer.invoke('cloud-download-history');
        } catch (e) {
          // 云服务可选,失败不影响本地历史展示
        }
      };
      w.removeHistory = (ids: string[]) => {
        // ids 可能是 MobX observable 数组(Proxy),无法被 IPC 的 structuredClone 序列化,
        // 展开成普通数组再发送。
        ipcRenderer.send(`history-remove`, ids == null ? ids : [...ids]);
      };
      w.getTopSites = async (count: number) => {
        return await ipcRenderer.invoke(`topsites-get`, count);
      };

      // 看图模式:ZIP 打包进度(主进程逐张拉取时上报,仅 image-viewer 页消费)。
      ipcRenderer.on('image-viewer-zip-progress', async (_e, data) => {
        const wp = await webFrame.executeJavaScript('window');
        if (wp.imageViewerZipProgress) wp.imageViewerZipProgress(data);
      });
    }
    if (window.location.href == "about:blank" && settings.doNotTrack) {
      const w = await webFrame.executeJavaScript('window');
      Object.defineProperty(w.navigator, 'doNotTrack', {value: 1});
    }
  })();
} else {
  (async function () {
    if (settings.doNotTrack) {
      const w = await webFrame.executeJavaScript('window');
      Object.defineProperty(w.navigator, 'doNotTrack', {value: 1});
    }
  })();
}

if (window.location.href.startsWith(WEBUI_BASE_URL) ||
  window.location.href == "about:blank") {
  window.addEventListener('DOMContentLoaded', () => {
    hostname = window.location.href.substr(WEBUI_BASE_URL.length);
    if (hostname.startsWith('settings')) document.title = '设置';
    else if (hostname.startsWith('history')) document.title = '历史记录';
    else if (hostname.startsWith('bookmarks')) document.title = '书签';
    else if (hostname.startsWith('downloads')) document.title = '下载管理';
    else if (hostname.startsWith('extensions')) document.title = '扩展程序';
    else if (hostname.startsWith('newtab')) {
      document.title = '新标签页';
    }
    else if (hostname.startsWith('image-viewer')) {
      document.title = '看图模式';
    }
  });

  window.addEventListener('message', async ({data}) => {
    if (data.type === 'storage') {
      const res = await ipcRenderer.invoke(`storage-${data.operation}`, {
        scope: data.scope,
        ...data.data,
      });

      postMsg(data, res);
    } else if (data.type === 'credentials-get-password') {
      const res = await ipcRenderer.invoke(
        'credentials-get-password',
        data.data,
      );
      postMsg(data, res);
    } else if (data.type === 'save-settings') {
      ipcRenderer.send('save-settings', {settings: data.data});
    } else if (data.type === 'show-adblock-rule') {
      ipcRenderer.send(`show-adblock-rule-${windowId}`);
    }
  });

  ipcRenderer.on('update-settings', async (e, data) => {
    const w = await webFrame.executeJavaScript('window');
    if (w.updateSettings) {
      w.updateSettings(data);
    }
  });

  ipcRenderer.on('credentials-insert', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-insert',
        data,
      },
      '*',
    );
  });

  ipcRenderer.on('credentials-update', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-update',
        data,
      },
      '*',
    );
  });

  ipcRenderer.on('credentials-remove', (e, data) => {
    window.postMessage(
      {
        type: 'credentials-remove',
        data,
      },
      '*',
    );
  });
  if(window.location.href == "about:blank") {
    window.addEventListener('message', async ({data}) => {
      if (data.type === 'supervideo-video-created') {
        //console.log("supervideo-video-created message", data);
        const tabId = ipcRenderer.sendSync('get-webcontents-id');
        ipcRenderer.send(`supervideo-video-created-${tabId}`, {
          url: data.src,
        });
      }
    });
  }
} else {
  window.addEventListener('message', async ({data}) => {
    if (data.type === 'supervideo-video-created') {
      //console.log("supervideo-video-created message", data);
      const tabId = ipcRenderer.sendSync('get-webcontents-id');
      ipcRenderer.send(`supervideo-video-created-${tabId}`, {
        url: data.src,
      });
    }
  });
}
