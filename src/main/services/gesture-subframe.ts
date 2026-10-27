// 鼠标右键手势注入器 —— 单一识别器,注入到每个帧(顶层 + 子帧)。
//
// 为什么用主进程注入而不是 view-preload:
//   - 跨源子帧:BrowserView nodeIntegrationInSubFrames:false → view-preload 根本
//     不进子帧,子帧里的右键事件截在帧内 document,顶层收不到。
//   - chrome-extension:// 顶层:跑在沙箱化渲染进程(sandboxed_renderer startupData
//     ===null),view-preload 不运行;且 webContents.executeJavaScript 在该状态下挂死,
//     只能 frame 级 WebFrameMain.executeJavaScript。
// 主进程在 did-frame-finish-load / frame-created / did-finish-load 时,把本脚本生成
// 的代码经 frame.executeJavaScript 注入每个帧。
//
// 回传通道(按帧角色):
//   - 顶层帧:命中 → console.log('__gesture_fire__:actionId') → 主进程 webContents
//     'console-message' 事件拦截分发(对所有协议/帧都触发,不依赖 ipcRenderer)。
//   - 子帧:命中 → window.top.postMessage → 顶层注入实例的 message 监听器转
//     console.log(跨源 postMessage 可靠,新标签页 pcapp iframe 走这条)。
//
// 重注入去重:配置变更或多次事件触发都会重注入同一帧。靠帧全局 __gestureVer 版本戳,
// 旧闭包 stale() 真 → 监听器空转,绝不双触发。

import {GestureConfig} from '~/main/menus/gesture-actions';
import {
  GESTURE_GRID,
  GESTURE_MIN_PATH,
  GESTURE_MIN_SAMPLE,
} from './gesture-recognizer';

// 识别算法 + 阈值。改这里只改一处(单一来源)。4 方向基向 L/R/U/D(无对角),与设置页
// 预设形状一致;两段折角(如「先下再右」)输出 "DR"。
const RECOGNIZER_SRC = `
  const GRID = ${GESTURE_GRID};
  const MIN_PATH = ${GESTURE_MIN_PATH};
  const MIN_SAMPLE = ${GESTURE_MIN_SAMPLE};
  const quantize = (dx, dy) =>
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : (dy >= 0 ? 'D' : 'U');
  const recognize = (pts) => {
    if (!pts || pts.length < 2) return null;
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (total < MIN_PATH) return null;
    const tokens = [];
    let segDx = 0;
    let segDy = 0;
    let lastToken = null;
    for (let i = 1; i < pts.length; i++) {
      segDx += pts[i].x - pts[i - 1].x;
      segDy += pts[i].y - pts[i - 1].y;
      const len = Math.hypot(segDx, segDy);
      if (len >= GRID) {
        const token = quantize(segDx, segDy);
        if (token !== lastToken) {
          tokens.push(token);
          lastToken = token;
        }
        const carry = len - GRID;
        segDx = (segDx / len) * carry;
        segDy = (segDy / len) * carry;
      }
    }
    return tokens.length > 0 ? tokens.join('') : null;
  };
`;

export const buildGestureCode = (config: GestureConfig): string => {
  const cfg = JSON.stringify(config);
  return `
(() => {
  try {
    const config = ${cfg};
    const isTop = (typeof window !== 'undefined' && window.top === window.self);
    const G = (typeof globalThis !== 'undefined' && globalThis) ||
              (typeof self !== 'undefined' && self) || this;
    const cleanupKey = '__rainseeGestureCleanup';
    const previousCleanup = G[cleanupKey];
    if (typeof previousCleanup === 'function') {
      try { previousCleanup(); } catch (_) {}
    }
    const hasSideButtons = config && config.sideButtons &&
      Object.keys(config.sideButtons).some((key) => !!config.sideButtons[key]);
    if (!config || (!config.enabled && !config.leftEnabled && !hasSideButtons)) return;

    G.__gestureVer = (G.__gestureVer || 0) + 1;
    const MY = G.__gestureVer;
    const stale = () => G.__gestureVer !== MY;

    ${RECOGNIZER_SRC}

    // 命中回传:顶层 console.log(主进程拦截),子帧 postMessage 顶层再转。
    const emit = (id) => {
      try { console.log('__gesture_fire__:' + id); } catch (_) {}
    };
    const fire = (id) => {
      if (!id) return;
      if (isTop) {
        emit(id);
      } else {
        try { window.top.postMessage({__gestureFire: true, actionId: id}, '*'); } catch (_) {}
      }
    };
    const fireLeft = (payload) => {
      if (!payload || !payload.actionId) return;
      const message = JSON.stringify(payload);
      if (isTop) {
        try { console.log('__left_gesture_fire__:' + message); } catch (_) {}
      } else {
        try { window.top.postMessage({__leftGestureFire: true, payload}, '*'); } catch (_) {}
      }
    };

    let tracking = false;
    let engaged = false;
    let suppressMenu = false;
    let points = [];
    let labelTimer = null;
    let canvas = null;
    let ctx = null;
    let rafScheduled = false;
    let leftTracking = false;
    let leftArmed = false;
    let leftTriggered = false;
    let leftTimer = null;
    let leftStart = null;
    let leftTarget = null;
    let leftActionId = null;
    let leftDirection = null;
    let leftHint = null;
    let leftPanelRect = null;
    let leftPanelReached = false;
    let leftNativeDrag = false;
    let leftLastPoint = null;
    let leftHintIcon = null;
    let leftHintText = null;
    let suppressClick = false;

    const ensureCanvas = () => {
      if (canvas && ctx) return;
      canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
      ctx = canvas.getContext('2d');
      (document.body || document.documentElement).appendChild(canvas);
      sizeCanvas();
    };
    const sizeCanvas = () => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const clearCanvas = () => {
      if (ctx && canvas) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      rafScheduled = false;
    };
    const draw = () => {
      rafScheduled = false;
      if (!ctx) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (points.length < 2) return;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = config.color;
      ctx.shadowColor = config.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    };
    const scheduleDraw = () => {
      if (rafScheduled) return;
      rafScheduled = true;
      window.requestAnimationFrame(draw);
    };
    const flashLabel = (id, x, y) => {
      if (!ctx) return;
      const label = config.labels ? config.labels[id] : null;
      if (!label) {
        clearCanvas();
        return;
      }
      ctx.shadowBlur = 0;
      ctx.font = '600 14px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = config.color;
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x + 12, y - 8);
      if (labelTimer != null) window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => {
        labelTimer = null;
        clearCanvas();
      }, 380);
    };

    const hideLeftHint = () => {
      if (leftHint && leftHint.parentNode) leftHint.parentNode.removeChild(leftHint);
      leftHint = null;
      leftHintIcon = null;
      leftHintText = null;
      leftPanelRect = null;
      leftPanelReached = false;
    };
    const showLeftHint = (actionId, direction) => {
      if (!leftHint) {
        leftHint = document.createElement('div');
        leftHint.style.cssText = [
          'position:fixed',
          'z-index:2147483647',
          'pointer-events:none',
          'width:116px',
          'height:78px',
          'padding:8px 6px',
          'box-sizing:border-box',
          'border:1px solid #000',
          'border-radius:10px',
          'background:rgba(0,0,0,.76)',
          'color:#fff',
          'font:600 13px/1.2 system-ui,"Microsoft YaHei",sans-serif',
          'text-align:center',
          'box-shadow:0 4px 14px rgba(0,0,0,.28)',
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'justify-content:center',
          'gap:4px',
          'transform:translate(-50%,-100%)',
          'transition:opacity .12s ease,transform .14s ease,background-color .14s ease,border-color .14s ease,box-shadow .14s ease',
        ].join(';');
        leftHintIcon = document.createElement('div');
        leftHintIcon.style.cssText = 'font:700 27px/1 system-ui,sans-serif;height:30px;';
        leftHintText = document.createElement('div');
        leftHintText.style.cssText = 'white-space:nowrap;';
        leftHint.appendChild(leftHintIcon);
        leftHint.appendChild(leftHintText);
        (document.body || document.documentElement).appendChild(leftHint);
      }
      const arrows = {U: '↑', D: '↓', L: '←', R: '→'};
      // 短标签由主进程按当前语言翻译后经 config 下发,注入脚本不做文案硬编码。
      const shortLabels = (config && config.leftShortLabels) || {};
      leftHintIcon.textContent = arrows[direction] || '';
      leftHintText.textContent = shortLabels[actionId] || actionId;
      const distance = (config.leftThreshold || 24) + 48;
      const vector = {U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0]}[direction] || [0, 0];
      const centerX = Math.max(112, Math.min(window.innerWidth - 112, leftStart.x + vector[0] * distance));
      const centerY = Math.max(42, Math.min(window.innerHeight - 42, leftStart.y + vector[1] * distance));
      const width = 116;
      const height = 78;
      leftPanelRect = {
        left: centerX - width / 2,
        right: centerX + width / 2,
        top: centerY - height / 2,
        bottom: centerY + height / 2,
      };
      leftHint.style.left = centerX + 'px';
      leftHint.style.top = centerY + 'px';
      leftHint.style.transform = leftPanelReached
        ? 'translate(-50%,-50%) scale(1.12)'
        : 'translate(-50%,-50%) scale(1)';
      leftHint.style.opacity = '1';
      leftHint.style.background = leftPanelReached ? (config.color || '#3b82f6') : 'rgba(0,0,0,.76)';
      leftHint.style.borderColor = leftPanelReached ? (config.color || '#3b82f6') : '#000';
    };

    const updateLeftPanelHit = (x, y) => {
      if (!leftPanelRect) return;
      const wasReached = leftPanelReached;
      leftPanelReached = x >= leftPanelRect.left && x <= leftPanelRect.right &&
        y >= leftPanelRect.top && y <= leftPanelRect.bottom;
      if (wasReached && !leftPanelReached) {
        // 进入过按钮区域后又移出:本次左键手势作废,移回来也不再触发。
        // 保留 leftTracking/suppressClick,松手时不会误点开链接。
        leftArmed = false;
        leftActionId = null;
        hideLeftHint();
        return;
      }
      if (leftHint) {
        leftHint.style.background = leftPanelReached
          ? (config.color || '#3b82f6')
          : 'rgba(0,0,0,.76)';
        leftHint.style.borderColor = leftPanelReached
          ? (config.color || '#3b82f6')
          : '#000';
        leftHint.style.transform = leftPanelReached
          ? 'translate(-50%,-50%) scale(1.12)'
          : 'translate(-50%,-50%) scale(1)';
        leftHint.style.boxShadow = leftPanelReached
          ? '0 8px 24px rgba(0,0,0,.36)'
          : '0 4px 14px rgba(0,0,0,.28)';
      }
    };

    const resetState = () => {
      tracking = false;
      engaged = false;
      suppressMenu = false;
      points = [];
      if (labelTimer != null) {
        window.clearTimeout(labelTimer);
        labelTimer = null;
      }
      clearCanvas();
      if (leftTimer != null) window.clearTimeout(leftTimer);
      leftTimer = null;
      leftTracking = false;
      leftArmed = false;
      leftTriggered = false;
      leftStart = null;
      leftTarget = null;
      leftActionId = null;
      leftDirection = null;
      hideLeftHint();
      leftNativeDrag = false;
      leftLastPoint = null;
      suppressClick = false;
    };
    const onResize = () => {
      if (stale()) return;
      resetState();
      sizeCanvas();
    };

    const getLeftTarget = (node) => {
      if (!node || !node.closest) return null;
      if (node.closest('input,textarea,select,button,[contenteditable="true"]')) return null;
      // 先选中文字再按住拖拽时,文字优先于其所在的链接。
      let selectedText = '';
      let selectionIncludesNode = false;
      try {
        const selection = window.getSelection && window.getSelection();
        selectedText = String(selection && selection.toString() || '').trim();
        selectionIncludesNode = !!(
          selectedText && selection && selection.rangeCount &&
          typeof selection.containsNode === 'function' &&
          selection.containsNode(node, true)
        );
      } catch (_) {}
      if (selectionIncludesNode) {
        return { url: '', imageUrl: '', isImage: false, text: selectedText, isText: true };
      }
      const image = node.closest('img');
      const anchor = node.closest('a[href]');
      if (!image && !anchor) return null;
      let imageUrl = '';
      if (image) imageUrl = image.currentSrc || image.src || image.getAttribute('src') || '';
      let linkUrl = '';
      if (anchor) linkUrl = anchor.href || anchor.getAttribute('href') || '';
      return {
        url: linkUrl || imageUrl,
        imageUrl,
        isImage: !!image,
        text: '',
        isText: false,
      };
    };

    const resetLeft = () => {
      if (leftTimer != null) window.clearTimeout(leftTimer);
      leftTimer = null;
      leftTracking = false;
      leftArmed = false;
      leftTriggered = false;
      leftStart = null;
      leftTarget = null;
      leftActionId = null;
      leftDirection = null;
      hideLeftHint();
      leftNativeDrag = false;
      leftLastPoint = null;
    };

    const onLeftDown = (e) => {
      if (stale() || !config.leftEnabled || !config.leftMap || e.button !== 0) return;
      const target = getLeftTarget(e.target);
      if (!target || (!target.url && !target.text)) {
        resetLeft();
        return;
      }
      resetLeft();
      leftTracking = true;
      // Left-button link dragging is the custom gesture entry point. Native
      // drag is adopted once Chromium emits dragstart so it can cross into
      // the browser chrome while drag events continue updating the hint.
      leftArmed = true;
      leftStart = {x: e.clientX, y: e.clientY};
      leftLastPoint = {x: e.clientX, y: e.clientY};
      leftTarget = target;
    };

    const moveLeft = (e, nativeDrag) => {
      if (stale() || !leftTracking || !leftArmed || !leftStart) return;
      // Some Chromium/Electron versions report additional pressed buttons in
      // buttons while a link is being dragged. Only require the left bit;
      // requiring an exact value of 1 drops otherwise valid move events.
      // Native dragover events are inconsistent across Chromium versions:
      // some report buttons=0 (or extra bits) even though the left drag is
      // still active. Mousemove remains strict; dragover relies on the
      // nativeDrag phase and coordinates instead of dropping the gesture.
      if (
        !nativeDrag &&
        typeof e.buttons === 'number' &&
        !(e.buttons & 1)
      ) return;
      if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
      if (nativeDrag && e.clientX === 0 && e.clientY === 0) return;
      leftLastPoint = {x: e.clientX, y: e.clientY};
      const dx = e.clientX - leftStart.x;
      const dy = e.clientY - leftStart.y;
      if (Math.hypot(dx, dy) < (config.leftThreshold || 24)) return;
      const direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
      const actionId = config.leftMap[direction];
      if (!actionId) {
        if (leftTriggered) {
          leftActionId = null;
          leftDirection = direction;
          hideLeftHint();
        } else {
          resetLeft();
        }
        return;
      }
      leftTriggered = true;
      suppressClick = true;
      leftActionId = actionId;
      const directionChanged = leftDirection !== direction;
      leftDirection = direction;
      if (directionChanged || !leftPanelRect) {
        leftPanelReached = false;
        showLeftHint(actionId, direction);
      }
      updateLeftPanelHit(e.clientX, e.clientY);
    };
    const onLeftMove = (e) => moveLeft(e, false);
    const onLeftDrag = (e) => moveLeft(e, true);

    const finishLeft = (e) => {
      if (leftTimer != null) window.clearTimeout(leftTimer);
      const triggered = leftTriggered;
      const actionId = leftActionId;
      const target = leftTarget;
      const localPoint = leftLastPoint || {x: e.clientX || 0, y: e.clientY || 0};
      let pointX = localPoint.x;
      let pointY = localPoint.y;
      if (triggered && leftPanelReached && actionId && target) {
        // copyImageAt works in top-frame viewport coordinates; include nested iframe offsets.
        try {
          let frame = window.frameElement;
          while (frame) {
            const rect = frame.getBoundingClientRect();
            pointX += rect.left;
            pointY += rect.top;
            frame = frame.ownerDocument && frame.ownerDocument.defaultView
              ? frame.ownerDocument.defaultView.frameElement
              : null;
          }
        } catch (_) {}
        fireLeft({
          actionId,
          url: target.url || '',
          imageUrl: target.imageUrl || '',
          isImage: !!target.isImage,
          text: target.text || '',
          isText: !!target.isText,
          x: pointX,
          y: pointY,
        });
      }
      resetLeft();
      // Do not consume mouseup here. Pages commonly use it to finish image
      // panning/scrolling, and this listener runs during the capture phase.
      // The click handler below still suppresses the link activation after a
      // gesture, so allowing mouseup to propagate does not re-open the link.
    };
    const onLeftUp = (e) => {
      if (e.button !== 0) return;
      finishLeft(e);
    };

    const onClick = (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onDragStart = (e) => {
      if (leftTracking && leftArmed) {
        // Let the browser own the drag once it starts. This keeps the original
        // gesture hint working through drag events while allowing the pointer
        // to cross into the app tab bar, whose existing drop target computes
        // the exact insertion index.
        leftNativeDrag = true;
        try {
          const url = leftTarget && leftTarget.url;
          const text = leftTarget && leftTarget.text;
          if ((url || text) && e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy';
            if (url) e.dataTransfer.setData('text/uri-list', url);
            e.dataTransfer.setData('text/plain', text || url);
            e.dataTransfer.setData('application/x-rainsee-left-gesture', '1');
          }
        } catch (_) {}
        return;
      }
      resetLeft();
    };
    const sideAction = (button) => config.sideButtons
      ? config.sideButtons[String(button)]
      : null;
    const onSideDown = (e) => {
      if (stale() || (e.button !== 3 && e.button !== 4) || !sideAction(e.button)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onSideUp = (e) => {
      if (stale() || (e.button !== 3 && e.button !== 4)) return;
      const actionId = sideAction(e.button);
      if (!actionId) return;
      e.preventDefault();
      e.stopPropagation();
      fire(actionId);
    };
    const onSideAuxClick = (e) => {
      if ((e.button !== 3 && e.button !== 4) || !sideAction(e.button)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onLeftDrop = (e) => {
      if (!leftTracking || !leftNativeDrag || !leftPanelReached) return;
      e.preventDefault();
      e.stopPropagation();
      finishLeft(e);
    };
    const onLeftDragOver = (e) => {
      if (!leftTracking || !leftNativeDrag) return;
      moveLeft(e, true);
      if (leftPanelReached) e.preventDefault();
    };
    const onLeftDragEnd = () => {
      if (!leftTracking || !leftNativeDrag) return;
      resetLeft();
    };

    // 右键手势:识别与动作分发由主进程 before-mouse-event 统一负责(加载期/跨源
    // 子帧也覆盖);页面侧在主进程判定「页面可自绘」时承担轨迹与标签的绘制,
    // 与 overlay BrowserWindow 兜底方案交互一致。页面收不到右键事件的场景
    // (加载隐藏期、扩展沙箱页)自动落到 overlay,两路不会同时画。
    const onDown = (e) => {
      if (stale()) return;
      if (!config.enabled) return;
      if (e.button !== 2) return; // 仅右键
      if (labelTimer != null) {
        window.clearTimeout(labelTimer);
        labelTimer = null;
        clearCanvas();
      }
      tracking = true;
      engaged = false;
      suppressMenu = false;
      points = [{x: e.clientX, y: e.clientY}];
    };
    const onMove = (e) => {
      if (stale() || !tracking) return;
      const last = points[points.length - 1];
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (Math.hypot(dx, dy) >= MIN_SAMPLE) points.push({x: e.clientX, y: e.clientY});
      if (!engaged) {
        let dist = 0;
        for (let i = 1; i < points.length; i++) {
          dist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        }
        if (dist >= MIN_PATH) {
          engaged = true;
          suppressMenu = true;
        }
      }
      if (engaged) {
        ensureCanvas();
        scheduleDraw();
      }
    };
    const onUp = (e) => {
      if (stale() || !tracking || e.button !== 2) return;
      tracking = false;
      if (!engaged) {
        suppressMenu = false;
        points = [];
        return;
      }
      const code = recognize(points);
      const lastPt = points[points.length - 1] || {x: e.clientX, y: e.clientY};
      const id = code ? (config.map ? config.map[code] : null) : null;
      if (id) {
        // 右键动作由主进程 before-mouse-event 触发。页面侧仅保留轨迹和标签反馈，
        // 避免 dom-ready 后两个识别器对同一次手势重复执行。
        flashLabel(id, lastPt.x, lastPt.y);
      } else {
        clearCanvas();
      }
      points = [];
    };
    const onCtx = (e) => {
      if (stale()) return;
      if (suppressMenu) {
        e.preventDefault();
        suppressMenu = false;
      }
    };
    const onPageHide = () => resetState();
    const onMessage = (e) => {
      if (stale()) return;
      const d = e && e.data;
      if (!d) return;
      if (e.source === window) return;
      if (d.__leftGestureFire && d.payload) {
        try { console.log('__left_gesture_fire__:' + JSON.stringify(d.payload)); } catch (_) {}
        return;
      }
      if (!d.__gestureFire || typeof d.actionId !== 'string') return;
      emit(d.actionId);
    };

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('mousedown', onSideDown, true);
    document.addEventListener('mouseup', onSideUp, true);
    document.addEventListener('auxclick', onSideAuxClick, true);
    document.addEventListener('mousedown', onLeftDown, true);
    document.addEventListener('mousemove', onLeftMove, true);
    document.addEventListener('mouseup', onLeftUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('drag', onLeftDrag, true);
    document.addEventListener('dragover', onLeftDragOver, true);
    document.addEventListener('drop', onLeftDrop, true);
    document.addEventListener('dragend', onLeftDragEnd, true);
    window.addEventListener('blur', resetState, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', onPageHide);

    // 顶层帧:接收子帧 postMessage 转来的手势,经 emit → console.log 回传主进程。
    if (isTop) {
      window.addEventListener('message', onMessage);
    }

    const cleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('mousedown', onSideDown, true);
      document.removeEventListener('mouseup', onSideUp, true);
      document.removeEventListener('auxclick', onSideAuxClick, true);
      document.removeEventListener('mousedown', onLeftDown, true);
      document.removeEventListener('mousemove', onLeftMove, true);
      document.removeEventListener('mouseup', onLeftUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dragstart', onDragStart, true);
      document.removeEventListener('drag', onLeftDrag, true);
      document.removeEventListener('dragover', onLeftDragOver, true);
      document.removeEventListener('drop', onLeftDrop, true);
      document.removeEventListener('dragend', onLeftDragEnd, true);
      window.removeEventListener('blur', resetState, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onPageHide);
      if (isTop) window.removeEventListener('message', onMessage);
      resetState();
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null;
      ctx = null;
      if (G[cleanupKey] === cleanup) delete G[cleanupKey];
    };
    G[cleanupKey] = cleanup;
  } catch (e) {
    // 安全网:注入脚本异常时经错误信号回传主进程日志(logger.ts 按 sourceId 跳过
    // chrome-extension 渲染层 console,只能这样落地),便于定位。
    try { console.log('__gesture_inj_err__:' + (e && e.message ? e.message : String(e))); } catch (_) {}
  }
})();
`;
};
