import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
} from 'electron';
import * as fs from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';

interface OverlayEntry {
  displayId: number;
  bounds: Electron.Rectangle;
  window: BrowserWindow;
  channels: string[];
  ready: Promise<void>;
  topmostTimer: NodeJS.Timeout | null;
  paintTimer: NodeJS.Timeout | null;
  resolvePaint: (() => void) | null;
}

// 开源版：截图「问 AI」通道已移除,仅保留以图搜图。
export type ScreenshotImageAction = 'search';

const timestamp = () => {
  const d = new Date();
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

/**
 * System-wide screenshot overlay. Screens are captured before any overlay is
 * shown, then one frameless window is placed on each display.
 */
export class DesktopScreenshotService {
  private overlays: OverlayEntry[] = [];

  private recycleTimer: NodeJS.Timeout | null = null;

  private readonly RECYCLE_DELAY = 60_000;

  private opening = false;

  private active = false;

  private openSequence = 0;

  public constructor(
    private onImageAction?: (
      action: ScreenshotImageAction,
      dataURL: string,
    ) => Promise<boolean>,
  ) {}

  public get visible() {
    return this.opening || this.active;
  }

  public async open() {
    // A foreground menu accelerator and globalShortcut can arrive together.
    if (this.visible) return;

    this.cancelRecycle();

    const sequence = ++this.openSequence;
    this.opening = true;
    this.active = true;
    try {
      const displays = screen.getAllDisplays();
      if (displays.length === 0) {
        this.active = false;
        return;
      }

      const thumbnailSize = displays.reduce(
        (size, display) => ({
          width: Math.max(
            size.width,
            Math.ceil(display.bounds.width * display.scaleFactor),
          ),
          height: Math.max(
            size.height,
            Math.ceil(display.bounds.height * display.scaleFactor),
          ),
        }),
        { width: 1, height: 1 },
      );
      const [sources] = await Promise.all([
        desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize,
          fetchWindowIcons: false,
        }),
        this.ensureOverlays(displays),
      ]);
      if (sequence !== this.openSequence) return;

      const paintTasks: Promise<void>[] = [];
      const captureEntries: OverlayEntry[] = [];
      for (let index = 0; index < displays.length; index += 1) {
        const display = displays[index];
        const entry = this.overlays.find(
          (item) => item.displayId === display.id && !item.window.isDestroyed(),
        );
        const source =
          sources.find((item) => `${item.display_id}` === `${display.id}`) ||
          sources[index];
        if (!entry || !source || source.thumbnail.isEmpty()) continue;
        captureEntries.push(entry);
        paintTasks.push(
          this.paintSnapshot(entry, source.thumbnail.toDataURL()),
        );
      }
      if (captureEntries.length === 0) {
        this.close();
        return;
      }

      await Promise.all(paintTasks);
      if (sequence !== this.openSequence) return;

      const cursorDisplay = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      );
      for (const entry of captureEntries) {
        if (entry.window.isDestroyed()) continue;
        this.startTopmost(entry);
        entry.window.showInactive();
        this.enforceTopmost(entry);
        this.revealWithoutAnimation(entry.window);
      }
      const focused =
        captureEntries.find((entry) => entry.displayId === cursorDisplay.id) ||
        captureEntries[0];
      focused?.window.show();
      focused?.window.focus();
      if (focused) this.enforceTopmost(focused);
    } catch (error) {
      console.error('[desktop-screenshot] open failed', error);
      this.close();
    } finally {
      if (sequence === this.openSequence) this.opening = false;
    }
  }

  public close(scheduleRecycle = true) {
    this.openSequence += 1;
    this.opening = false;
    this.active = false;
    for (const entry of this.overlays) {
      if (entry.topmostTimer) clearInterval(entry.topmostTimer);
      entry.topmostTimer = null;
      this.finishPaint(entry);
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send('visible', false);
        entry.window.hide();
        if (process.platform !== 'linux') entry.window.setOpacity(0);
      }
    }
    if (scheduleRecycle) this.scheduleRecycle();
  }

  public dispose() {
    this.cancelRecycle();
    this.close(false);
    const entries = this.overlays.splice(0);
    for (const entry of entries) {
      for (const channel of entry.channels) ipcMain.removeAllListeners(channel);
      if (!entry.window.isDestroyed()) entry.window.destroy();
    }
  }

  private cancelRecycle() {
    if (!this.recycleTimer) return;
    clearTimeout(this.recycleTimer);
    this.recycleTimer = null;
  }

  private scheduleRecycle() {
    this.cancelRecycle();
    if (this.overlays.length === 0) return;
    this.recycleTimer = setTimeout(() => {
      this.recycleTimer = null;
      for (const entry of [...this.overlays]) this.destroyOverlay(entry);
    }, this.RECYCLE_DELAY);
    this.recycleTimer.unref?.();
  }

  private async ensureOverlays(displays: Electron.Display[]) {
    const displayIds = new Set(displays.map((display) => display.id));
    for (const entry of [...this.overlays]) {
      if (!displayIds.has(entry.displayId)) this.destroyOverlay(entry);
    }
    for (const display of displays) {
      const existing = this.overlays.find(
        (entry) =>
          entry.displayId === display.id && !entry.window.isDestroyed(),
      );
      if (existing) {
        existing.bounds = display.bounds;
        existing.window.setBounds(display.bounds, false);
      } else {
        this.createOverlay(display);
      }
    }
    await Promise.all(this.overlays.map((entry) => entry.ready));
  }

  private createOverlay(display: Electron.Display) {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    require('@electron/remote/main').enable(win.webContents);
    if (process.platform !== 'linux') {
      // Make the first native show invisible; reveal only after React has
      // painted the captured bitmap, avoiding Windows' show animation/black frame.
      win.setOpacity(0);
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    const id = win.webContents.id;
    const channels = [
      `hide-${id}`,
      `screenshot-activate-${id}`,
      `screenshot-save-${id}`,
      `screenshot-copy-${id}`,
      `screenshot-search-${id}`,
      `screenshot-render-ready-${id}`,
    ];
    let resolveLoading: () => void = () => undefined;
    let loadingFinished = false;
    let loadingTimer: NodeJS.Timeout | null = null;
    const ready = new Promise<void>((resolve) => {
      resolveLoading = resolve;
    });
    const finishLoading = () => {
      if (loadingFinished) return;
      loadingFinished = true;
      if (loadingTimer) clearTimeout(loadingTimer);
      loadingTimer = null;
      resolveLoading();
    };
    const entry: OverlayEntry = {
      displayId: display.id,
      bounds: display.bounds,
      window: win,
      channels,
      ready,
      topmostTimer: null,
      paintTimer: null,
      resolvePaint: null,
    };
    this.overlays.push(entry);

    ipcMain.on(`hide-${id}`, () => this.close());
    ipcMain.on(`screenshot-render-ready-${id}`, () => this.finishPaint(entry));
    ipcMain.on(`screenshot-activate-${id}`, () => {
      for (const other of this.overlays) {
        if (other !== entry && !other.window.isDestroyed()) other.window.hide();
      }
    });
    ipcMain.on(`screenshot-copy-${id}`, (_event, dataURL: string) => {
      try {
        clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
      } catch (error) {
        console.error('[desktop-screenshot] copy failed', error);
      }
    });
    const runImageAction = async (
      action: ScreenshotImageAction,
      dataURL: string,
    ) => {
      this.close();
      if (!this.onImageAction) return;
      await this.onImageAction(action, dataURL);
    };
    ipcMain.on(`screenshot-search-${id}`, (_event, dataURL: string) => {
      void runImageAction('search', dataURL);
    });
    // 开源版：screenshot-ai 通道已移除。
    ipcMain.on(`screenshot-save-${id}`, async (_event, dataURL: string) => {
      try {
        const t = getMainTranslator(
          Application.instance.settings?.object?.language,
        );
        const image = nativeImage.createFromDataURL(dataURL);
        const result = await dialog.showSaveDialog({
          title: t('shotSaveDialogTitle'),
          defaultPath: `screenshot-${timestamp()}.png`,
          filters: [{ name: t('shotFilterPng'), extensions: ['png'] }],
        });
        if (!result.canceled && result.filePath) {
          await fs.promises.writeFile(result.filePath, image.toPNG());
        }
      } catch (error) {
        console.error('[desktop-screenshot] save failed', error);
      }
    });

    win.on('closed', () => {
      finishLoading();
      this.finishPaint(entry);
      if (entry.topmostTimer) clearInterval(entry.topmostTimer);
      entry.topmostTimer = null;
      this.overlays = this.overlays.filter((item) => item !== entry);
      for (const channel of channels) ipcMain.removeAllListeners(channel);
    });
    win.webContents.once('did-finish-load', () => {
      finishLoading();
    });
    win.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(
        '[desktop-screenshot] renderer load failed',
        code,
        description,
      );
      finishLoading();
      if (!win.isDestroyed()) win.destroy();
    });
    loadingTimer = setTimeout(() => {
      console.warn('[desktop-screenshot] renderer load timed out');
      finishLoading();
    }, 8000);
    loadingTimer.unref?.();

    const url =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:4444/screenshot.html'
        : pathToFileURL(join(app.getAppPath(), 'build', 'screenshot.html'))
            .href;
    void win.loadURL(url);
  }

  private paintSnapshot(entry: OverlayEntry, snapshot: string) {
    this.finishPaint(entry);
    return new Promise<void>((resolve) => {
      entry.resolvePaint = resolve;
      entry.paintTimer = setTimeout(() => {
        console.warn('[desktop-screenshot] renderer paint handshake timed out');
        this.finishPaint(entry);
      }, 3000);
      entry.paintTimer.unref?.();
      if (entry.window.isDestroyed()) {
        this.finishPaint(entry);
        return;
      }
      entry.window.webContents.send('visible', true, {
        snapshot,
        source: 'desktop',
        displayId: entry.displayId,
      });
    });
  }

  private finishPaint(entry: OverlayEntry) {
    if (entry.paintTimer) clearTimeout(entry.paintTimer);
    entry.paintTimer = null;
    const resolve = entry.resolvePaint;
    entry.resolvePaint = null;
    resolve?.();
  }

  private startTopmost(entry: OverlayEntry) {
    if (entry.topmostTimer) clearInterval(entry.topmostTimer);
    this.enforceTopmost(entry);
    entry.topmostTimer = setInterval(() => this.enforceTopmost(entry), 350);
    entry.topmostTimer.unref?.();
  }

  private destroyOverlay(entry: OverlayEntry) {
    this.finishPaint(entry);
    if (entry.topmostTimer) clearInterval(entry.topmostTimer);
    entry.topmostTimer = null;
    for (const channel of entry.channels) ipcMain.removeAllListeners(channel);
    this.overlays = this.overlays.filter((item) => item !== entry);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }

  private enforceTopmost(entry: OverlayEntry) {
    const win = entry.window;
    if (win.isDestroyed()) return;
    try {
      // Windows may constrain a fullscreen/kiosk window to workArea or let the
      // Shell taskbar reclaim topmost. Reapply the physical display bounds and
      // the highest Electron z-order while the capture overlay is active.
      win.setBounds(entry.bounds, false);
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.moveTop();
    } catch {
      // The window can be destroyed between the guard and native calls.
    }
  }

  private revealWithoutAnimation(win: BrowserWindow) {
    if (win.isDestroyed() || process.platform === 'linux') return;
    try {
      win.setOpacity(1);
    } catch {
      // Opacity is unsupported on a small number of window managers.
    }
  }
}
