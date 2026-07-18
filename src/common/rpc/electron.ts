import type { IpcMain, IpcMainInvokeEvent, IpcRenderer } from 'electron';

export type RpcMainEvent = IpcMainInvokeEvent;

export type RpcMainHandler<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? (event: RpcMainEvent, ...args: Args) => Result
    : never;
};

let ipcMainRef: IpcMain | undefined;
let ipcRendererRef: IpcRenderer | undefined;

const receivers = new Set<ChannelReceiver<any>>();

export const setIpcMain = (ipcMain: IpcMain) => {
  ipcMainRef = ipcMain;

  for (const receiver of receivers) {
    receiver.register();
  }
};

export const setIpcRenderer = (ipcRenderer: IpcRenderer) => {
  ipcRendererRef = ipcRenderer;
};

const resolveIpcRenderer = (): IpcRenderer | undefined => {
  if (ipcRendererRef) return ipcRendererRef;

  try {
    const electron =
      (globalThis as any).electron ??
      (globalThis as any).require?.('electron');

    if (electron?.ipcRenderer) {
      ipcRendererRef = electron.ipcRenderer;
    }
  } catch {
    // electron not exposed yet
  }

  return ipcRendererRef;
};

class ChannelReceiver<T extends Record<string, any>> {
  private _handler?: RpcMainHandler<T>;

  constructor(private readonly channelName: string) {}

  public set handler(handler: RpcMainHandler<T>) {
    this._handler = handler;
    this.register();
  }

  public get handler() {
    return this._handler;
  }

  public register() {
    if (!ipcMainRef || !this._handler) return;

    ipcMainRef.removeHandler(this.channelName);
    ipcMainRef.handle(this.channelName, async (event, method, args = []) => {
      const fn = this._handler?.[method as keyof RpcMainHandler<T>];

      if (typeof fn !== 'function') {
        throw new Error(
          `RPC handler "${String(method)}" is not registered on ${this.channelName}`,
        );
      }

      return fn.call(this._handler, event, ...args);
    });
  }
}

export class RendererToMainChannel<T extends Record<string, any>> {
  private readonly receiver: ChannelReceiver<T>;

  constructor(private readonly channelName: string) {
    this.receiver = new ChannelReceiver<T>(channelName);
    receivers.add(this.receiver);
  }

  public getReceiver() {
    return this.receiver;
  }

  public getInvoker(): T {
    return new Proxy(
      {},
      {
        get: (_, method) => {
          return (...args: unknown[]) => {
            const ipcRenderer = resolveIpcRenderer();

            if (!ipcRenderer) {
              throw new Error('IPC renderer is not configured');
            }

            return ipcRenderer.invoke(this.channelName, String(method), args);
          };
        },
      },
    ) as T;
  }
}
