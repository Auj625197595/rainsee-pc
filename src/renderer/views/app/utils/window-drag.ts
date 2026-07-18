import * as React from 'react';
import { ipcRenderer } from 'electron';

import { getCurrentWindow } from './windows';

// 按住一个区域拖动主窗口。
//
// 用于自定义标题栏品牌区、侧栏顶部拖拽条等「按住即拖窗口」的区域。这些区域
// 一律设 -webkit-app-region: no-drag(避免 drag 区吞掉 mouseenter/单击等鼠标
// 事件,也绕开 CSS drag 在部分布局下对原生 hit-test 不生效的问题),改为手动
// 监听 mousedown:用鼠标屏幕坐标差驱动窗口 setPosition;移动 < 4px 视作抖动
// (即单击)。最大化状态下先 unmaximize 再按按下时鼠标在视口内的位置重定位,
// 使恢复后鼠标仍落在原视觉点,贴合 Windows 原生标题栏拖动手感。
//
// onSimpleClick 在「按下后未发生拖动」的松开时触发(品牌区用于单击弹手机端
// 面板)。不需要单击行为的调用方传空函数即可,但仍可用返回的 onClick 抑制
// 拖动结束当次的 click。
export const useWindowDragMove = (onSimpleClick: () => void) => {
  const cbRef = React.useRef(onSimpleClick);
  cbRef.current = onSimpleClick;

  const didDragRef = React.useRef(false);
  const stateRef = React.useRef<{
    startX: number; // mousedown 时鼠标屏幕坐标
    startY: number;
    winX: number; // mousedown 时窗口左上角(非最大化)
    winY: number;
    anchorX: number; // 鼠标在 normal 窗口内的锚点,用于还原后保持指针不脱离拖拽区
    anchorY: number;
    maximized: boolean;
    winW: number; // 锁定的窗口宽度,拖拽期间保持不变
    winH: number; // 锁定的窗口高度,拖拽期间保持不变
  } | null>(null);

  const onMove = (e: MouseEvent) => {
    const st = stateRef.current;
    if (!st) return;
    const dx = e.screenX - st.startX;
    const dy = e.screenY - st.startY;
    if (!didDragRef.current) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 抖动范围内仍视作单击
      didDragRef.current = true;
      if (st.maximized) {
        // 最大化起步:getNormalBounds 已在 mousedown 时保存,所以这里可以明确恢复到
        // normal 尺寸并重定位。若继续沿用最大化窗口的 clientX,从屏幕右侧起拖时鼠标
        // 会落到较窄的 normal 窗口之外,renderer 随即收不到后续 mousemove。
        const win = getCurrentWindow();
        const nx = Math.round(e.screenX - st.anchorX);
        const ny = Math.round(e.screenY - st.anchorY);
        win.unmaximize();
        win.setBounds({
          x: nx,
          y: ny,
          width: st.winW,
          height: st.winH,
        });
        st.startX = e.screenX;
        st.startY = e.screenY;
        st.winX = nx;
        st.winY = ny;
        st.maximized = false;
        return;
      }
    }
    // normal 起步或已从最大化恢复:setBounds 平移并显式锁定 normal 尺寸。
    getCurrentWindow().setBounds({
      x: Math.round(st.winX + dx),
      y: Math.round(st.winY + dy),
      width: st.winW,
      height: st.winH,
    });
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('blur', onUp);
    try {
      ipcRenderer.send(
        `window-drag-resize-suppress-${getCurrentWindow().id}`,
        false,
      );
    } catch {
      // 窗口可能在拖拽中关闭,忽略。
    }
    stateRef.current = null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 仅左键拖动
    const win = getCurrentWindow();
    if (win.isFullScreen()) {
      // 全屏(F11)下按住拖拽区:退出全屏即可,本次不开始拖拽——退出全屏后窗口 bounds
      // 大幅变化,基准需重新记录。用户松开后再次拖动即可正常移动窗口。
      win.setFullScreen(false);
      return;
    }
    e.preventDefault(); // 避免文字/图片被拖选或原生拖拽
    didDragRef.current = false;
    // 记录 mousedown 时的完整 bounds:拖拽期间用 setBounds 显式锁定 width/height,使
    // 窗口尺寸绝对恒定——既不被 Windows Aero Snap 吸附成最大化/半屏而变大,也不因任何
    // resize 副作用而变小。只用 setPosition 移动会留下尺寸被外部改动的窗口(曾表现为
    // 拖动中「尺寸慢慢变大」)。
    const maximized = win.isMaximized();
    const currentBounds = win.getBounds();
    const normalBounds = maximized ? win.getNormalBounds() : currentBounds;
    // 水平方向按最大化窗口内的相对位置换算到 normal 窗口,模拟系统标题栏的
    // restore-on-drag 锚点;纵向保留顶部拖拽条内的原始位置。
    const anchorX = maximized
      ? Math.round(
          (e.clientX / Math.max(1, currentBounds.width)) * normalBounds.width,
        )
      : e.clientX;
    stateRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      winX: normalBounds.x,
      winY: normalBounds.y,
      anchorX: Math.max(0, Math.min(normalBounds.width - 1, anchorX)),
      anchorY: Math.max(0, Math.min(normalBounds.height - 1, e.clientY)),
      maximized,
      winW: normalBounds.width,
      winH: normalBounds.height,
    };
    // 拖拽期间抑制 Snap:主进程 will-resize 阻止窗口被撑大到工作区(最大化/半屏)。
    // maximized 起步的 unmaximize 是缩小,不会被挡,故始终置位即可。
    ipcRenderer.send(`window-drag-resize-suppress-${win.id}`, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  };

  const onClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      // 刚拖动结束的松开:抑制本次单击回调(下次 mousedown 会重置标志)
      e.preventDefault();
      e.stopPropagation();
      didDragRef.current = false;
      return;
    }
    cbRef.current();
  };

  return { onMouseDown, onClick };
};
