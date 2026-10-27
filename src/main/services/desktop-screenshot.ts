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
import { monitorEventLoopDelay } from 'perf_hooks';
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

export type ScreenshotImageAction = 'search' | 'ai';

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

  // [ss-perf] 诊断:主进程事件循环阻塞直方图(原生采样,开销可忽略)。每次唤起时
  // 打出自上次唤起以来的最大阻塞,判断快捷键回调是否被主线程长任务推迟。
  private loopDelay = (() => {
    try {
      const histogram = monitorEventLoopDelay({ resolution: 20 });
      histogram.enable();
      return histogram;
    } catch {
      return null;
    }
  })();

  public constructor(
    private onImageAction?: (
      action: ScreenshotImageAction,
      dataURL: string,
    ) => Promise<boolean>,
  ) {}

  public get visible() {
    return this.opening || this.active;
  }

  public async open(trigger = 'unknown') {
    const t0 = Date.now();
    const since = () => Date.now() - t0;
    // A foreground menu accelerator and globalShortcut can arrive together.
    if (this.visible) {
      console.log(
        `[ss-perf] open skipped trigger=${trigger} opening=${this.opening} active=${this.active}`,
      );
      return;
    }

    const recyclePending = !!this.recycleTimer;
    this.cancelRecycle();

    const sequence = ++this.openSequence;
    this.opening = true;
    this.active = true;
    // 主线程繁忙度:setImmediate 回调迟到多少,就说明主进程事件循环被占用了多久
    // (快捷键回调本身也会被同样程度地推迟)。
    setImmediate(() =>
      console.log(`[ss-perf] #${sequence} main loop lag=${since()}ms`),
    );
    const loop = this.loopDelay;
    console.log(
      `[ss-perf] #${sequence} open trigger=${trigger} overlays=${this.overlays.length} recyclePending=${recyclePending}` +
        (loop
          ? ` loopDelaySinceLast max=${Math.round(loop.max / 1e6)}ms p99=${Math.round(loop.percentile(99) / 1e6)}ms`
          : ''),
    );
    loop?.reset();
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
      console.log(
        `[ss-perf] #${sequence} displays=${displays
          .map((d) => `${d.id}:${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`)
          .join(',')} thumbnail=${thumbnailSize.width}x${thumbnailSize.height} +${since()}ms`,
      );
      // Create/load the overlay first: getSources blocks the main thread for
      // a few hundred ms on Windows, and the overlay renderer can parse its
      // bundles in parallel during that time. Hidden windows are not captured.
      const overlaysReady = this.ensureOverlays(displays).then(() =>
        console.log(`[ss-perf] #${sequence} overlays ready +${since()}ms`),
      );
      console.log(`[ss-perf] #${sequence} ensureOverlays sync +${since()}ms`);
      const capture = desktopCapturer
        .getSources({
          types: ['screen'],
          thumbnailSize,
          fetchWindowIcons: false,
        })
        .then((result) => {
          console.log(
            `[ss-perf] #${sequence} getSources done count=${result.length} +${since()}ms`,
          );
          return result;
        });
      console.log(`[ss-perf] #${sequence} getSources sync +${since()}ms`);
      const [sources] = await Promise.all([capture, overlaysReady]);
      if (sequence !== this.openSequence) {
        console.log(`[ss-perf] #${sequence} superseded after capture`);
        return;
      }

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
        // A hidden overlay that has been shown before gets its rAF throttled to
        // ~1fps, so the renderer's double-rAF paint handshake took ~2s on every
        // reopen. The screen is already captured here, so show the window fully
        // transparent first; it keeps compositing at full rate and is revealed
        // with opacity 1 once the snapshot has painted. Linux has no opacity, so
        // it keeps painting hidden to avoid flashing the previous capture.
        if (process.platform !== 'linux') {
          entry.window.setOpacity(0);
          entry.window.showInactive();
        }
        // Send raw pixels instead of a PNG data URL: toDataURL() PNG-encodes a
        // full-resolution screen on the main thread (~360ms at 2560x1440),
        // while toBitmap() is a ~3ms copy and the renderer decodes it in ~15ms.
        const encodeStart = Date.now();
        const { width, height } = source.thumbnail.getSize();
        const bitmap = source.thumbnail.toBitmap();
        console.log(
          `[ss-perf] #${sequence} display=${display.id} toBitmap=${Date.now() - encodeStart}ms size=${width}x${height} +${since()}ms`,
        );
        paintTasks.push(
          this.paintSnapshot(
            entry,
            { bitmap, width, height },
            sequence,
            t0,
          ),
        );
      }
      if (captureEntries.length === 0) {
        console.warn(`[ss-perf] #${sequence} no usable capture, closing`);
        this.close();
        return;
      }

      await Promise.all(paintTasks);
      console.log(`[ss-perf] #${sequence} all painted +${since()}ms`);
      if (sequence !== this.openSequence) {
        console.log(`[ss-perf] #${sequence} superseded after paint`);
        return;
      }

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
      console.log(`[ss-perf] #${sequence} shown total=${since()}ms`);
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
      `screenshot-ai-${id}`,
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
    ipcMain.on(`screenshot-ai-${id}`, (_event, dataURL: string) => {
      void runImageAction('ai', dataURL);
    });
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
    const createdAt = Date.now();
    console.log(`[ss-perf] create overlay display=${display.id}`);
    win.webContents.once('did-finish-load', () => {
      console.log(
        `[ss-perf] overlay display=${display.id} did-finish-load ${Date.now() - createdAt}ms`,
      );
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

  private paintSnapshot(
    entry: OverlayEntry,
    snapshot: { bitmap: Buffer; width: number; height: number },
    sequence: number,
    t0: number,
  ) {
    this.finishPaint(entry);
    const sentAt = Date.now();
    return new Promise<void>((resolve) => {
      entry.resolvePaint = () => {
        console.log(
          `[ss-perf] #${sequence} display=${entry.displayId} paint handshake=${Date.now() - sentAt}ms +${Date.now() - t0}ms`,
        );
        resolve();
      };
      entry.paintTimer = setTimeout(() => {
        console.warn(
          `[desktop-screenshot] renderer paint handshake timed out #${sequence} display=${entry.displayId}`,
        );
        this.finishPaint(entry);
      }, 3000);
      entry.paintTimer.unref?.();
      if (entry.window.isDestroyed()) {
        this.finishPaint(entry);
        return;
      }
      entry.window.webContents.send('visible', true, {
        bitmap: snapshot.bitmap,
        width: snapshot.width,
        height: snapshot.height,
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
