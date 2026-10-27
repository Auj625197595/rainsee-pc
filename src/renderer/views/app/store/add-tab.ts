import store from '.';
import { observable } from 'mobx';
import { animateTabPosition } from '../utils/tabs';

export class AddTabStore {
  public left = 0;
  public top = 0;

  public ref: HTMLDivElement;

  // ref(重新)挂载时,把已计算好的二维位置立即应用到新 DOM 节点。
  // 按钮靠 anime 命令式 transform 定位。DOM 节点重建(scrollable 切换导致
  // AddTab 卸载/重挂)后 transform 丢失,因此挂载时必须恢复完整 X/Y 坐标。
  // 此处在挂载瞬间补一次定位,让它一出现就在正确位置。
  public setRef = (ref: HTMLDivElement) => {
    this.ref = ref;
    if (ref) {
      animateTabPosition(this.left, this.top, ref, false);
    }
  };

  public setPosition(left: number, top: number, animation: boolean) {
    // Always retain the target while the scroll-mode button is unmounted so
    // its absolute-positioned variant can be restored at the right location.
    const unchanged = this.left === left && this.top === top;
    this.left = left;
    this.top = top;
    if (!this.ref) return;
    if (animation && unchanged) return;
    animateTabPosition(left, top, this.ref, animation);
  }
}
