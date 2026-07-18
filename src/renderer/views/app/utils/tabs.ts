import anime from 'animejs';
import { TAB_ANIMATION_DURATION } from '../constants';

export const animateTab = (
  property: 'translateX' | 'width',
  value: number,
  domElement: any,
  animation: boolean,
) => {
  if (!domElement) return;

  if (animation) {
    anime({
      targets: domElement,
      [property]: value,
      duration: TAB_ANIMATION_DURATION,
      easing: 'easeOutCirc',
    });
  } else {
    // 瞬时定位前,先移除该元素上正在运行的 anime 动画。anime.set 不会取消既有动画,
    // 若元素上有一条仍在跑的 anime() 动画(如启动时 updateSettings 先把「+」按钮 animate
    // 到 translateX(0),150ms 内未结束),其 rAF tick 会把这里写入的瞬时值覆盖回去,
    // 表现为「+」恢复后卡在最前面、直到鼠标触发一次新动画才正确。
    anime.remove(domElement);
    anime.set(domElement, {
      [property]: value,
    });
  }
};
