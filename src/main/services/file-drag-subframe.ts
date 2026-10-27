// 网页子帧的外部文件拖拽桥(主进程经 WebFrameMain.executeJavaScript 注入)。
//
// BrowserView 的 nodeIntegrationInSubFrames:false,view-preload 不进子帧;主页
// (yjllq://newtab)整页就是一个 pcapp 跨源 iframe,文件拖到上面时顶层文档收不到
// 任何拖拽事件,超级拖拽面板不会亮。本脚本与顶层 preload file-drag-bridge 同套规则:
//   - dragover 节流后 window.top.postMessage 心跳;
//   - 派发末尾判断子帧网页是否接管,未接管的 dragover 由我们 preventDefault;
//   - 未接管且扩展名可识别的 drop:preventDefault,把 File 对象 postMessage 给顶层,
//     顶层 preload 用 webUtils.getPathForFile 取路径(File 结构化克隆保留路径)。

import {
  IMAGE_FILE_EXTS,
  KOODO_READER_EXTS,
  PAGE_FILE_DRAG_MESSAGE_KEY,
  VIDEO_FILE_EXTS,
} from '~/constants/file-drop';

const DROPPABLE_EXTS = [
  ...KOODO_READER_EXTS,
  ...IMAGE_FILE_EXTS,
  ...VIDEO_FILE_EXTS,
  'html',
  'htm',
  'mhtml',
  'mht',
];

export const FILE_DRAG_SUBFRAME_CODE = `(() => {
  if (window === window.top) return;
  // document 级去重:同一文档重复注入不重复挂监听;导航后新文档重新挂。
  if (document.__rainseeFileDragRelay) return;
  document.__rainseeFileDragRelay = true;
  const KEY = ${JSON.stringify(PAGE_FILE_DRAG_MESSAGE_KEY)};
  const EXTS = ${JSON.stringify(DROPPABLE_EXTS)};
  let internal = false;
  let last = 0;
  let leaveTimer = null;
  let pendingTail = null;
  const post = (data) => {
    try { window.top.postMessage({ [KEY]: data }, '*'); } catch (_) {}
  };
  const isFiles = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  };
  const isNativeTarget = (e) => {
    const node = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!node || typeof node.closest !== 'function') return false;
    if (node.closest('input[type="file" i]') || node.closest('textarea')) return true;
    return !!node.isContentEditable;
  };
  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };
  const cancelLeave = () => {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  };
  // 在本次派发末尾运行 fn(所有子帧网页监听之后),读 defaultPrevented 判断是否接管。
  const runAfterPage = (type, fn) => {
    if (pendingTail) window.removeEventListener(pendingTail.type, pendingTail.fn);
    const tail = (e) => { pendingTail = null; fn(e); };
    pendingTail = { type, fn: tail };
    window.addEventListener(type, tail, { once: true });
  };
  window.addEventListener('dragstart', () => { internal = true; }, true);
  window.addEventListener('dragend', () => {
    internal = false;
    cancelLeave();
    last = 0;
    post({ type: 'end' });
  }, true);
  window.addEventListener('dragover', (e) => {
    if (internal || !isFiles(e)) return;
    cancelLeave();
    const now = Date.now();
    if (now - last >= 150) {
      last = now;
      const dt = e.dataTransfer;
      const file = dt.files && dt.files[0];
      let mime = '';
      const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
      for (const item of items) {
        if (item.kind === 'file') { mime = item.type || ''; break; }
      }
      post({ type: 'over', name: (file && file.name) || '', mime });
    }
    if (isNativeTarget(e)) return;
    runAfterPage('dragover', (ev) => {
      if (ev.defaultPrevented) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    });
  }, true);
  window.addEventListener('dragleave', (e) => {
    if (!last || e.relatedTarget) return;
    cancelLeave();
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      last = 0;
      post({ type: 'end' });
    }, 120);
  }, true);
  window.addEventListener('drop', (e) => {
    if (internal || !isFiles(e)) { internal = false; return; }
    cancelLeave();
    last = 0;
    if (isNativeTarget(e)) { post({ type: 'end' }); return; }
    runAfterPage('drop', (ev) => {
      let files = [];
      if (!ev.defaultPrevented) {
        files = Array.prototype.slice
          .call((ev.dataTransfer && ev.dataTransfer.files) || [])
          .filter((f) => EXTS.indexOf(extOf(f.name || '')) >= 0);
        if (files.length) ev.preventDefault();
      }
      post({ type: 'drop', files });
    });
  }, true);
})();`;
