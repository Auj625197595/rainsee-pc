import {ipcMain} from 'electron';
import type {IpcMainEvent, IpcMainInvokeEvent} from 'electron';

type IpcListener = (event: IpcMainEvent, ...args: any[]) => void;
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

export class TrackedIpcMain {
  private handlerChannels = new Set<string>();
  private listeners: Array<{channel: string; listener: IpcListener}> = [];
  private disposed = false;

  public handle(channel: string, handler: IpcHandler) {
    if (this.disposed) return;
    ipcMain.handle(channel, handler);
    this.handlerChannels.add(channel);
  }

  public on(channel: string, listener: IpcListener) {
    if (this.disposed) return;
    ipcMain.on(channel, listener);
    this.listeners.push({channel, listener});
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const channel of this.handlerChannels) {
      ipcMain.removeHandler(channel);
    }
    this.handlerChannels.clear();

    for (const {channel, listener} of this.listeners) {
      ipcMain.removeListener(channel, listener);
    }
    this.listeners = [];
  }
}
