import anime from 'animejs';
import { TAB_ANIMATION_DURATION } from '../constants';

type AnimatedProperty = 'translateX' | 'translateY' | 'width';

// 每个元素最近一次请求的目标值,以及最晚一条动画的预计结束时间。
// 模型(tab.width/left/top)在发起动画时就已写成目标值,之后同值的 animation=true
// 调用会短路、不再触碰 DOM。一旦动画没跑完,DOM 就永久停在中间态,典型表现是
// 新建标签时主线程卡顿后,新标签停在 width≈0 的细条、旁边留一块空白,直到 resize 才恢复。
// 动画被中断的两种途径:
//  1. 瞬时定位走 anime.remove(el),会顺带杀掉该元素上「其它属性」正在跑的动画
//     (例如 setPosition(false) 掐断刚开始的 width 0→目标 动画);
//  2. rAF 被挂起/节流(窗口被遮挡、document hidden、长任务)时 anime 引擎不 tick。
// 因此:瞬时路径恢复该元素全部属性的目标值;动画路径再挂一个 setTimeout 兜底收敛
// (定时器在 rAF 停摆时仍会触发),到点后若没有更晚的动画,直接把 DOM 落到目标。
interface ElementLayoutState {
  targets: Partial<Record<AnimatedProperty, number>>;
  animUntil: number;
  settleTimer?: ReturnType<typeof setTimeout>;
}

const SETTLE_SLACK = 80;
const layoutStates = new WeakMap<object, ElementLayoutState>();

const getState = (domElement: object): ElementLayoutState => {
  let state = layoutStates.get(domElement);
  if (!state) {
    state = { targets: {}, animUntil: 0 };
    layoutStates.set(domElement, state);
  }
  return state;
};

const snapToTargets = (domElement: any, state: ElementLayoutState) => {
  // 瞬时定位前,先移除该元素上正在运行的 anime 动画。anime.set 不会取消既有动画,
  // 若元素上有一条仍在跑的 anime() 动画(如启动时 updateSettings 先把「+」按钮 animate
  // 到 translateX(0),150ms 内未结束),其 rAF tick 会把这里写入的瞬时值覆盖回去,
  // 表现为「+」恢复后卡在最前面、直到鼠标触发一次新动画才正确。
  anime.remove(domElement);
  if (state.settleTimer) {
    clearTimeout(state.settleTimer);
    state.settleTimer = undefined;
  }
  state.animUntil = 0;
  // anime.remove 会连带清掉其它属性的动画,所以这里把所有已知目标一起落位,
  // 被掐断的属性直接跳到终点,不会卡在中间态。
  anime.set(domElement, { ...state.targets });
};

const scheduleSettle = (domElement: any, state: ElementLayoutState) => {
  state.animUntil = performance.now() + TAB_ANIMATION_DURATION;
  if (state.settleTimer) clearTimeout(state.settleTimer);
  state.settleTimer = setTimeout(() => {
    state.settleTimer = undefined;
    // 期间又有新的动画发起时,上面已经把计时器重置到新动画之后,不会走到这里。
    if (performance.now() + 1 < state.animUntil) return;
    snapToTargets(domElement, state);
  }, TAB_ANIMATION_DURATION + SETTLE_SLACK);
};

export const animateTab = (
  property: AnimatedProperty,
  value: number,
  domElement: any,
  animation: boolean,
) => {
  if (!domElement) return;

  const state = getState(domElement);
  state.targets[property] = value;

  if (animation) {
    anime({
      targets: domElement,
      [property]: value,
      duration: TAB_ANIMATION_DURATION,
      easing: 'easeOutCirc',
    });
    scheduleSettle(domElement, state);
  } else {
    snapToTargets(domElement, state);
  }
};

export const animateTabPosition = (
  x: number,
  y: number,
  domElement: any,
  animation: boolean,
) => {
  if (!domElement) return;

  const state = getState(domElement);
  state.targets.translateX = x;
  state.targets.translateY = y;

  // Anime instances cache and rewrite the complete transform string. Keeping
  // X and Y in one instance prevents the second animation restoring stale X.
  if (animation) {
    anime({
      targets: domElement,
      translateX: x,
      translateY: y,
      duration: TAB_ANIMATION_DURATION,
      easing: 'easeOutCirc',
    });
    scheduleSettle(domElement, state);
  } else {
    snapToTargets(domElement, state);
  }
};
