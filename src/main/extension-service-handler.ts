import { RpcMainEvent, RpcMainHandler } from '~/common/rpc/electron';
import { session, webContents } from 'electron';
import {
  extensionMainChannel,
  ExtensionMainService,
  ActionAnchorRect,
} from '~/common/rpc/extensions';
import { Application } from './application';

export class ExtensionServiceHandler
  implements RpcMainHandler<ExtensionMainService> {
  constructor() {
    extensionMainChannel.getReceiver().handler = this;
  }

  inspectBackgroundPage(e: RpcMainEvent, id: string): void {
    const hostOf = (wc: Electron.WebContents): string => {
      try {
        const url = wc.getURL();
        return url ? new URL(url).hostname : '';
      } catch {
        return '';
      }
    };
    webContents
      .getAllWebContents()
      .find(
        (x) =>
          x.session === Application.instance.sessions.view &&
          hostOf(x) === id,
      )?.openDevTools({ mode: 'detach' });
  }

  async uninstall(e: RpcMainEvent, id: string): Promise<boolean> {
    try {
      return await Application.instance.sessions.uninstallExtension(id);
    } catch (error) {
      console.error('extension RPC uninstall failed', id, error);
      return false;
    }
  }

  dispatchActionClick(e: RpcMainEvent, id: string, tabId: number, anchorRect?: ActionAnchorRect): void {
    console.log(`[action-click] dispatchActionClick recv id=${id} tabId=${tabId} anchorRect=${JSON.stringify(anchorRect)}`);
    try {
      Application.instance.sessions.chromeExtensions?.activateExtensionAction(
        id,
        typeof tabId === 'number' ? tabId : -1,
        anchorRect,
      );
      console.log(`[action-click] dispatchActionClick -> activateExtensionAction returned ok id=${id}`);
    } catch (err) {
      console.error('[action-click] dispatchActionClick failed', err);
    }
  }
}
