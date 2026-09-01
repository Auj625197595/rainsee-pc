import type { IpcRenderer } from 'electron';
import type {RainseeWebUIBridge} from './webui-bridge-policy';

// Renderer pages with `nodeIntegration: false` (settings, history, bookmarks,
// newtab, …) have no synchronous `require` on the page window. A static
// `import { ipcRenderer } from 'electron'` is lowered by webpack into an eager,
// unguarded `require("electron")` (see the `externals` config in
// webpack.config.base.js) that runs the instant the module is evaluated — long
// before the view preload has bridged `electron`/`require` onto the page
// window. The result is the "require is not defined" crash that white-screens
// the whole bundle.
//
// This proxy defers resolution until a property is actually accessed (i.e. at
// call time inside event handlers/effects), by which point the preload has
// exposed `window.electron`. It is a drop-in replacement for the named import:
// change the import source from 'electron' to this module and keep calling
// `ipcRenderer.send(...)` / `.invoke(...)` / `.on(...)` as before.

let cached: IpcRenderer | undefined;

const bridgeListeners = new Map<
  string,
  Map<Function, {unsubscribe: () => void; wrapped: Function}>
>();

const getWebUIBridge = (): RainseeWebUIBridge | undefined => {
  const bridge = (globalThis as any).rainseeWebUI;
  return bridge && typeof bridge.invoke === 'function' ? bridge : undefined;
};

const getInvokeBridge = () => {
  const invoke = getWebUIBridge()?.invoke;
  return typeof invoke === 'function' ? invoke : undefined;
};

const waitForInvokeBridge = async () => {
  // view-preload injects the sandbox-safe bridge through executeJavaScript,
  // which can finish one or more tasks after a renderer bundle evaluates.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const invoke = getInvokeBridge();
    if (invoke) return invoke;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  return undefined;
};

const resolveIpcRenderer = (): IpcRenderer | undefined => {
  if (cached) return cached;

  try {
    const electron =
      (globalThis as any).electron ?? (globalThis as any).require?.('electron');

    if (electron?.ipcRenderer) {
      cached = electron.ipcRenderer as IpcRenderer;
    }
  } catch {
    // electron has not been bridged onto the page window yet
  }

  return cached;
};

export const ipcRenderer: IpcRenderer = new Proxy({} as IpcRenderer, {
  get: (_target, prop) => {
    const real = resolveIpcRenderer();

    if (real) {
      const value = (real as any)[prop];
      return typeof value === 'function' ? value.bind(real) : value;
    }

    const bridge = getWebUIBridge();
    if (bridge) {
      if (prop === 'invoke') return bridge.invoke.bind(bridge);
      if (prop === 'send') return bridge.send.bind(bridge);
      if (prop === 'on' || prop === 'once') {
        return (channel: string, callback: Function) => {
          const wrapped = (...payload: any[]) => {
            if (prop === 'once') {
              const record = bridgeListeners.get(channel)?.get(callback);
              record?.unsubscribe();
              bridgeListeners.get(channel)?.delete(callback);
            }
            callback({}, ...payload);
          };
          const unsubscribe = (bridge.on as any)(channel, wrapped) as () => void;
          let records = bridgeListeners.get(channel);
          if (!records) {
            records = new Map();
            bridgeListeners.set(channel, records);
          }
          records.get(callback)?.unsubscribe();
          records.set(callback, {unsubscribe, wrapped});
          return ipcRenderer;
        };
      }
      if (prop === 'removeListener') {
        return (channel: string, callback: Function) => {
          const records = bridgeListeners.get(channel);
          records?.get(callback)?.unsubscribe();
          records?.delete(callback);
          if (records?.size === 0) bridgeListeners.delete(channel);
          return ipcRenderer;
        };
      }
      if (prop === 'removeAllListeners') {
        return (channel?: string) => {
          const channels = channel ? [channel] : Array.from(bridgeListeners.keys());
          for (const name of channels) {
            const records = bridgeListeners.get(name);
            records?.forEach((record) => record.unsubscribe());
            bridgeListeners.delete(name);
          }
          return ipcRenderer;
        };
      }
    }

    // Sandboxed WebUI pages expose only rainseeWebUI. The proxy keeps the
    // existing ipcRenderer-shaped call sites while routing every operation
    // through the host/channel policy in preload.
    if (prop === 'invoke') {
      const invoke = getInvokeBridge();
      if (invoke) return invoke;

      // Some stores issue their initial request during module evaluation.
      // Wait for the asynchronous preload bridge instead of capturing an
      // unavailable nested electron object.
      return async (...args: any[]) => {
        const fn = await waitForInvokeBridge();
        if (!fn) {
          throw new Error(
            'ipcRenderer.invoke is not available after preload initialization',
          );
        }
        return (fn as (...callArgs: any[]) => any)(...args);
      };
    }

    if (prop === 'send') {
      const fn = getWebUIBridge()?.send;
      if (typeof fn === 'function') return fn;
    }

    throw new Error(
      `ipcRenderer is not available yet (accessed "${String(
        prop,
      )}" before the preload exposed electron on this page)`,
    );
  },
}) as IpcRenderer;
