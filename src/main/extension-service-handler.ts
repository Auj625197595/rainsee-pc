import { RpcMainEvent, RpcMainHandler } from '~/common/rpc/electron';
import { webContents } from 'electron';
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

  async inspectBackgroundPage(e: RpcMainEvent, id: string): Promise<void> {
    const sessions = Application.instance.sessions;
    const extension = sessions.getLoadedExtension(id);
    const manifest = extension?.manifest;

    if (manifest?.manifest_version === 3 && manifest.background?.service_worker) {
      // MV3 extensions do not have a persistent background WebContents. Route
      // them through the service-worker inspector used by the details view.
      const result = await sessions.inspectExtensionTarget(id, 'service-worker');
      if (!result.ok) {
        console.warn('[extension-inspect] service worker unavailable', id, result.message);
      }
      return;
    }

    // Keep MV2 support for extensions that still expose a generated background
    // page. Their background page is a regular WebContents.
    const target = webContents.getAllWebContents().find((wc) => {
      if (wc.session !== sessions.view) return false;
      try {
        return new URL(wc.getURL()).hostname === id;
      } catch {
        return false;
      }
    });
    if (target && !target.isDestroyed()) {
      target.openDevTools({ mode: 'detach' });
    } else {
      console.warn('[extension-inspect] background page unavailable', id);
    }
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
