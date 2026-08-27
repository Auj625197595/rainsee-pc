import {BrowserWindow} from 'electron';

import type {NativeRightGestureVisualUpdate} from '../services/native-right-gesture';

/** 右键按住达到该时长(ms)且轨迹已 engaged,才创建承载窗口。 */
export const GESTURE_WINDOW_HOLD_THRESHOLD_MS = 160;

const OVERLAY_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
    canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  </style>
</head>
<body>
  <canvas></canvas>
  <script>
    const {ipcRenderer} = require('electron');
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d', {alpha: true, desynchronized: true});
    let points = [];
    let color = '#3b82f6';
    let animationFrame = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = true;
    };
    const clear = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      points = [];
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    const appendPoint = (point) => {
      const previous = points[points.length - 1];
      if (!previous) {
        points.push(point);
        return;
      }
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (distance < 1) return;
      points.push(point);
    };
    const draw = () => {
      animationFrame = 0;
      if (points.length < 2) return;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.strokeStyle = color;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const point = points[i];
        const next = points[i + 1];
        context.quadraticCurveTo(
          point.x,
          point.y,
          (point.x + next.x) / 2,
          (point.y + next.y) / 2,
        );
      }
      const last = points[points.length - 1];
      context.lineTo(last.x, last.y);
      context.globalAlpha = 0.24;
      context.lineWidth = 7;
      context.stroke();
      context.globalAlpha = 1;
      context.lineWidth = 3;
      context.stroke();
    };
    const scheduleDraw = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(draw);
    };

    ipcRenderer.on('right-gesture-visual', (_event, update) => {
      if (!update) return;
      if (update.phase === 'reset') {
        clear();
        return;
      }
      if (update.color) color = update.color;
      if (update.phase === 'start') {
        clear();
        points = [{x: update.x, y: update.y}];
        return;
      }
      if (update.phase === 'replay') {
        // 窗口迟到补画:整段已缓冲轨迹一次到位。
        clear();
        if (Array.isArray(update.points) && update.points.length) {
          for (const point of update.points) appendPoint(point);
          scheduleDraw();
        }
        return;
      }
      if (update.phase === 'move') {
        appendPoint({x: update.x, y: update.y});
        if (update.engaged) scheduleDraw();
        return;
      }
      if (update.phase === 'end') {
        appendPoint({x: update.x, y: update.y});
        if (!update.label) {
          clear();
          return;
        }
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        draw();
        context.font = '600 14px system-ui, "Microsoft YaHei", sans-serif';
        context.fillStyle = color;
        context.textBaseline = 'bottom';
        context.fillText(update.label, update.x + 12, update.y - 8);
      }
    });
    window.addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>`;

interface OverlayUpdate extends NativeRightGestureVisualUpdate {
  /** 建窗迟到时整段轨迹补画(坐标已含 offset)。 */
  points?: Array<{x: number; y: number}>;
}

export class RightGestureOverlay {
  private window: BrowserWindow | null = null;
  private ready = false;
  private pending: OverlayUpdate | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: OverlayUpdate | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  /** 右键按下时刻;未在跟踪为 0。 */
  private holdStart = 0;
  /** 建窗前的轨迹缓冲(已加 offset),供窗口加载完成后整段补画。 */
  private bufferedPoints: Array<{x: number; y: number}> = [];

  public constructor(private readonly parent: BrowserWindow) {}

  public update(
    update: NativeRightGestureVisualUpdate,
    offset: {x: number; y: number} = {x: 0, y: 0},
  ) {
    if (this.parent.isDestroyed()) return;
    const x = update.x + offset.x;
    const y = update.y + offset.y;

    // 手势终止:立即销毁承载窗口,回到零驻留状态。
    if (update.phase === 'reset') {
      this.destroyWindow();
      return;
    }

    // 窗口尚未创建:只跟踪与缓冲。普通右键点菜单、快速轻挥全程零窗口开销。
    if (!this.window) {
      if (update.phase === 'start') {
        this.holdStart = Date.now();
        this.bufferedPoints = [{x, y}];
        return;
      }
      if (update.phase === 'move') {
        this.bufferedPoints.push({x, y});
        if (
          update.engaged &&
          this.holdStart &&
          Date.now() - this.holdStart >= GESTURE_WINDOW_HOLD_THRESHOLD_MS
        ) {
          this.ensureWindow();
          // 点已进缓冲,只需登记 pending 供加载完成后整段重放。
          if (this.window && !this.window.isDestroyed()) {
            this.pending = {...update, x, y};
          }
        }
        return;
      }
      // end(未达建窗阈值的轻挥):丢弃缓冲,不建窗。
      this.holdStart = 0;
      this.bufferedPoints = [];
      return;
    }
    if (this.window.isDestroyed()) return;

    if (!this.ready) {
      // 窗口加载中:轨迹继续进缓冲,仅记最后一个包,加载完成后整段重放。
      this.bufferedPoints.push({x, y});
      this.pending = {...update, x, y};
      return;
    }

    this.flushPendingMove();
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    if (update.phase === 'move') {
      this.pendingMove = {...update, x, y};
      if (!this.moveTimer) {
        this.moveTimer = setTimeout(() => this.flushPendingMove(), 12);
      }
      return;
    }

    if (update.phase === 'start' || !this.visible) {
      this.syncBounds();
      this.window.showInactive();
      this.visible = true;
    }
    this.window.webContents.send('right-gesture-visual', {...update, x, y});
    if (update.phase === 'end') {
      // 鼠标抬起:无标签立即销毁;有标签等展示完再销毁,下次手势重建。
      this.hideTimer = setTimeout(
        () => this.destroyWindow(),
        update.label ? 420 : 0,
      );
    }
  }

  public destroy() {
    this.destroyWindow();
  }

  /** 真正创建承载窗口,并挂加载完成后的整段轨迹重放。 */
  private ensureWindow() {
    const window = new BrowserWindow({
      parent: this.parent,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    window.setIgnoreMouseEvents(true, {forward: true});
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed() || this.window !== window) return;
      this.ready = true;
      const update = this.pending;
      this.pending = null;
      const points = this.bufferedPoints;
      this.bufferedPoints = [];
      // 已过时(如手势途中被 reset):不留驻留窗口,直接销毁。
      if (!update || update.phase === 'reset') {
        this.destroyWindow();
        return;
      }
      const replay: OverlayUpdate = {
        ...update,
        phase: 'replay',
        points,
      };
      this.syncBounds();
      window.showInactive();
      this.visible = true;
      window.webContents.send('right-gesture-visual', replay);
      // end 在重放之后单独补发,渲染层追加终点并画动作标签。
      if (update.phase === 'end') {
        window.webContents.send('right-gesture-visual', update);
        this.hideTimer = setTimeout(
          () => this.destroyWindow(),
          update.label ? 420 : 0,
        );
      }
    });
    this.window = window;
    void window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`,
    );
  }

  /** 销毁承载窗口并清空全部手势期状态,回到构造后的零驻留状态。 */
  private destroyWindow() {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.hideTimer = null;
    this.moveTimer = null;
    this.pendingMove = null;
    this.pending = null;
    this.bufferedPoints = [];
    this.holdStart = 0;
    this.ready = false;
    this.visible = false;
    if (this.window) {
      if (!this.window.isDestroyed()) this.window.destroy();
      this.window = null;
    }
  }

  private syncBounds() {
    const bounds = this.parent.getContentBounds();
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const current = window.getBounds();
    if (
      current.x !== bounds.x ||
      current.y !== bounds.y ||
      current.width !== bounds.width ||
      current.height !== bounds.height
    ) {
      window.setBounds(bounds, false);
    }
  }

  private flushPendingMove() {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    const update = this.pendingMove;
    this.pendingMove = null;
    if (
      update &&
      this.visible &&
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.webContents.isDestroyed()
    ) {
      this.window.webContents.send('right-gesture-visual', update);
    }
  }
}
