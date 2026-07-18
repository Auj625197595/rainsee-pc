import store from '.';
import { observable } from 'mobx';
import { animateTab } from '../utils/tabs';

export class AddTabStore {
  public left = 0;

  public ref: HTMLDivElement;

  // ref(重新)挂载时,把已计算好的 left 立即应用到新 DOM 节点。
  // 按钮靠 anime 命令式设 transform: translateX(left) 定位(见 style.ts: position:absolute;
  // left:0)。DOM 节点重建(scrollable 切换导致 AddTab 卸载/重挂)后 transform 丢失,
  // 按钮会退回 translateX(0)、停在标签栏最前面,直到下一次布局才被重新定位。
  // 此处在挂载瞬间补一次定位,让它一出现就在正确位置。
  public setRef = (ref: HTMLDivElement) => {
    this.ref = ref;
    if (ref) {
      animateTab('translateX', this.left, ref, false);
    }
  };

  public setLeft(left: number, animation: boolean) {
    // 始终记录目标 left:按钮未渲染时(scrollable 持平时被卸载、ref 为空)也不丢位置,
    // 这样重挂载时 setRef 能拿到最新的 left 应用到新节点。仅 DOM 应用阶段在 ref 为空时跳过。
    this.left = left;
    if (!this.ref) return;
    animateTab('translateX', left, this.ref, animation);
  }
}
