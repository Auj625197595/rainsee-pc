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

// 识别算法 + 阈值。改这里只改一处(单一来源)。4 方向基向 L/R/U/D(无对角),与设置页
// 预设形状一致;两段折角(如「先下再右」)输出 "DR"。
const RECOGNIZER_SRC = `
  const GRID = 12;
  const MIN_PATH = 24;
  const MIN_SAMPLE = 2;
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
    if (!config || !config.enabled) return;

    const isTop = (typeof window !== 'undefined' && window.top === window.self);
    const G = (typeof globalThis !== 'undefined' && globalThis) ||
              (typeof self !== 'undefined' && self) || this;
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

    let tracking = false;
    let engaged = false;
    let suppressMenu = false;
    let points = [];
    let labelTimer = null;
    let canvas = null;
    let ctx = null;
    let rafScheduled = false;

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
    };

    const onDown = (e) => {
      if (stale()) return;
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
        fire(id);
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

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('blur', resetState, true);
    window.addEventListener('resize', () => {
      if (canvas) sizeCanvas();
    });
    window.addEventListener('pagehide', resetState);

    // 顶层帧:接收子帧 postMessage 转来的手势,经 emit → console.log 回传主进程。
    if (isTop) {
      window.addEventListener('message', (e) => {
        if (stale()) return;
        const d = e && e.data;
        if (!d || !d.__gestureFire || typeof d.actionId !== 'string') return;
        if (e.source === window) return; // 自身,非子帧
        emit(d.actionId);
      });
    }
  } catch (e) {
    // 安全网:注入脚本异常时经错误信号回传主进程日志(logger.ts 按 sourceId 跳过
    // chrome-extension 渲染层 console,只能这样落地),便于定位。
    try { console.log('__gesture_inj_err__:' + (e && e.message ? e.message : String(e))); } catch (_) {}
  }
})();
`;
};
