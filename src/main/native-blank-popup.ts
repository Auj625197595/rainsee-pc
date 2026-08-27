import {app, BrowserView, BrowserWindow} from 'electron';
import type {WebContents} from 'electron';

interface NativeBlankPopupEntry {
  opener: WebContents;
  window: BrowserWindow;
  overlay?: BrowserView;
}

const canLoadInOverlay = (rawUrl: string) => {
  try {
    return ['http:', 'https:', 'file:', 'chrome-extension:', 'yjllq:'].includes(
      new URL(rawUrl).protocol,
    );
  } catch {
    return false;
  }
};

/**
 * 保留 about:blank 原生 BrowserWindow 作为 WindowProxy/document.write 的宿主，
 * 仅将它后续的 renderer 导航转移到覆盖其内容区的 BrowserView。
 */
export class NativeBlankPopupManager {
  private entries = new Map<number, NativeBlankPopupEntry>();

  private overlayOwners = new Map<number, number>();

  public manage(opener: WebContents, popupWindow: BrowserWindow) {
    const popupContents = popupWindow.webContents;
    const popupContentsId = popupContents.id;
    if (popupContents.isDestroyed() || this.entries.has(popupContentsId)) return;

    const entry: NativeBlankPopupEntry = {opener, window: popupWindow};
    this.entries.set(popupContentsId, entry);

    popupContents.on('will-navigate', (event, url) => {
      if (!canLoadInOverlay(url) || popupWindow.isDestroyed()) return;
      event.preventDefault();
      queueMicrotask(() => this.navigateOverlay(popupContentsId, url));
    });

    popupWindow.on('resize', () => this.resizeOverlay(entry));
    popupWindow.once('closed', () => this.destroyEntry(popupContentsId));
    console.log(
      `[native-blank-popup] managed popup=${popupContentsId} opener=${opener.id}`,
    );
  }

  public relayToOpener(
    sender: WebContents,
    popupContentsId: number,
    message: unknown,
    targetOrigin: string,
  ) {
    const ownerId = this.overlayOwners.get(sender.id);
    const entry = this.entries.get(popupContentsId);
    if (
      ownerId !== popupContentsId ||
      !entry ||
      entry.window.isDestroyed() ||
      entry.window.webContents.isDestroyed()
    ) return;

    entry.window.webContents.send(
      'native-blank-popup-relay-to-opener',
      message,
      targetOrigin,
    );
  }

  public isOpenerClosed(sender: WebContents, popupContentsId: number) {
    const ownerId = this.overlayOwners.get(sender.id);
    const entry = this.entries.get(popupContentsId);
    return (
      ownerId !== popupContentsId ||
      !entry ||
      entry.opener.isDestroyed() ||
      entry.window.isDestroyed()
    );
  }

  public closeFromOverlay(sender: WebContents, popupContentsId: number) {
    if (this.overlayOwners.get(sender.id) !== popupContentsId) return;
    const entry = this.entries.get(popupContentsId);
    if (entry && !entry.window.isDestroyed()) entry.window.close();
  }

  private navigateOverlay(popupContentsId: number, url: string) {
    const entry = this.entries.get(popupContentsId);
    if (!entry || entry.window.isDestroyed()) return;

    if (!entry.overlay || entry.overlay.webContents.isDestroyed()) {
      const preload = `${app.getAppPath()}/build/view-preload.bundle.js`;
      const overlay = new BrowserView({
        webPreferences: {
          session: entry.window.webContents.session,
          preload,
          additionalArguments: [
            `--rainsee-native-blank-popup=${popupContentsId}`,
          ],
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          allowRunningInsecureContent: true,
          contextIsolation: false,
          sandbox: false,
          enableRemoteModule: false,
          plugins: true,
          nativeWindowOpen: true,
          webSecurity: true,
          javascript: true,
          worldSafeExecuteJavaScript: true,
        },
      });
      entry.overlay = overlay;
      const overlayContentsId = overlay.webContents.id;
      this.overlayOwners.set(overlayContentsId, popupContentsId);
      overlay.webContents.once('destroyed', () => {
        this.overlayOwners.delete(overlayContentsId);
      });
      require('@electron/remote/main').enable(overlay.webContents);
      entry.window.addBrowserView(overlay);
      this.resizeOverlay(entry);
    }

    const overlay = entry.overlay;
    overlay.webContents.loadURL(url).catch((error) => {
      if (!overlay.webContents.isDestroyed()) {
        console.error(
          `[native-blank-popup] overlay load failed popup=${popupContentsId} url=${url}`,
          error,
        );
      }
    });
    console.log(
      `[native-blank-popup] will-navigate popup=${popupContentsId} overlay=${overlay.webContents.id} url=${url}`,
    );
  }

  private resizeOverlay(entry: NativeBlankPopupEntry) {
    if (
      !entry.overlay ||
      entry.overlay.webContents.isDestroyed() ||
      entry.window.isDestroyed()
    ) return;
    const {width, height} = entry.window.getContentBounds();
    entry.overlay.setBounds({x: 0, y: 0, width, height});
    entry.overlay.setAutoResize({width: true, height: true});
  }

  private destroyEntry(popupContentsId: number) {
    const entry = this.entries.get(popupContentsId);
    this.entries.delete(popupContentsId);
    if (!entry?.overlay) return;
    this.overlayOwners.delete(entry.overlay.webContents.id);
    if (!entry.overlay.webContents.isDestroyed()) {
      entry.overlay.webContents.destroy();
    }
  }
}
