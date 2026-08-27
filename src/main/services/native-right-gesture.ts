import { GestureConfig } from '~/main/menus/gesture-actions';
import {
  GesturePoint,
  GESTURE_MIN_PATH,
  GESTURE_MIN_SAMPLE,
  recognizeGesture,
} from './gesture-recognizer';

interface PreventableEvent {
  preventDefault(): void;
}

interface NativeMouseEvent {
  type: string;
  button?: string;
  x: number;
  y: number;
}

export interface NativeRightGestureVisualUpdate {
  phase: 'start' | 'move' | 'end' | 'reset';
  x: number;
  y: number;
  engaged?: boolean;
  color?: string;
  label?: string;
}

export class NativeRightGesture {
  private tracking = false;
  private engaged = false;
  private suppressMenu = false;
  private menuSuppressedForGesture = false;
  private pathLength = 0;
  private points: GesturePoint[] = [];
  private pendingAction: string | null = null;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly getConfig: () => GestureConfig,
    private readonly dispatch: (actionId: string) => void,
  ) {}

  public handle(
    event: PreventableEvent,
    mouse: NativeMouseEvent,
  ): NativeRightGestureVisualUpdate | null {
    const config = this.getConfig();
    if (!config.enabled) {
      this.reset();
      return {phase: 'reset', x: mouse.x, y: mouse.y};
    }

    if (mouse.type === 'mouseDown' && mouse.button === 'right') {
      this.cancelPendingAction();
      this.tracking = true;
      this.engaged = false;
      this.suppressMenu = false;
      this.menuSuppressedForGesture = false;
      this.pathLength = 0;
      this.points = [{ x: mouse.x, y: mouse.y }];
      return {
        phase: 'start',
        x: mouse.x,
        y: mouse.y,
        color: config.color,
      };
    }

    if (mouse.type === 'mouseMove' && this.tracking) {
      const last = this.points[this.points.length - 1];
      const distance = Math.hypot(mouse.x - last.x, mouse.y - last.y);
      if (distance < GESTURE_MIN_SAMPLE) return null;

      this.points.push({ x: mouse.x, y: mouse.y });
      this.pathLength += distance;
      if (!this.engaged && this.pathLength >= GESTURE_MIN_PATH) {
        this.engaged = true;
        this.suppressMenu = true;
      }
      return {
        phase: 'move',
        x: mouse.x,
        y: mouse.y,
        engaged: this.engaged,
        color: config.color,
      };
    }

    if (mouse.type === 'mouseUp' && mouse.button === 'right' && this.tracking) {
      const last = this.points[this.points.length - 1];
      if (
        last &&
        Math.hypot(mouse.x - last.x, mouse.y - last.y) >= GESTURE_MIN_SAMPLE
      ) {
        this.points.push({ x: mouse.x, y: mouse.y });
      }

      this.tracking = false;
      if (!this.engaged) {
        this.reset();
        return {phase: 'reset', x: mouse.x, y: mouse.y};
      }

      const code = recognizeGesture(this.points);
      const actionId = code ? config.map[code] : null;
      this.points = [];
      this.pathLength = 0;
      this.engaged = false;
      if (actionId) {
        this.pendingAction = actionId;
        if (this.menuSuppressedForGesture) {
          this.flushPendingAction();
        } else {
          // Windows 通常在 mouseUp 后再发 contextMenu。先给菜单事件一个短窗口，
          // 避免 back/close-tab 抢先销毁承载抑制状态的旧页面。
          this.actionTimer = setTimeout(() => this.flushPendingAction(), 50);
        }
      }
      return {
        phase: 'end',
        x: mouse.x,
        y: mouse.y,
        color: config.color,
        label: actionId ? config.labels[actionId] || actionId : undefined,
      };
    }

    if (mouse.type === 'contextMenu') {
      if (this.suppressMenu) {
        event.preventDefault();
        this.menuSuppressedForGesture = true;
        this.flushPendingAction();
      }
      this.suppressMenu = false;
      return null;
    }

    if (mouse.type === 'mouseLeave') {
      this.reset();
      return {phase: 'reset', x: mouse.x, y: mouse.y};
    }
    return null;
  }

  public reset(preserveMenuSuppression = this.suppressMenu) {
    this.tracking = false;
    this.engaged = false;
    if (!preserveMenuSuppression) {
      this.suppressMenu = false;
      this.menuSuppressedForGesture = false;
      this.cancelPendingAction();
    }
    this.pathLength = 0;
    this.points = [];
  }

  public consumeContextMenuSuppression() {
    const shouldSuppress =
      this.suppressMenu || this.menuSuppressedForGesture;
    if (!shouldSuppress) return false;

    this.suppressMenu = false;
    this.menuSuppressedForGesture = false;
    this.flushPendingAction();
    return true;
  }

  private flushPendingAction() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    const actionId = this.pendingAction;
    this.pendingAction = null;
    if (actionId) this.dispatch(actionId);
  }

  private cancelPendingAction() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.pendingAction = null;
  }
}
