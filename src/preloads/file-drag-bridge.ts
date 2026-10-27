import {ipcRenderer, webUtils} from './sandbox-bridge';

import {
  PAGE_FILE_DRAG_MESSAGE_KEY,
  getHeaderDropFileType,
} from '~/constants/file-drop';

// 网页 BrowserView 内的外部文件拖拽桥。
//
// 顶部栏(app.html)与网页是不同的 BrowserView,文件拖到网页区域时顶部栏收不到
// 任何拖拽事件。这里在网页 preload 里观察拖拽,节流上报心跳让顶部栏亮出超级拖拽
// 面板;同时判断网页自身是否接管了拖拽(上传区等):
//   - 在 window 捕获阶段(所有网页监听之前)挂一个 window 冒泡阶段的一次性监听,
//     它排在本次派发的最后,读 defaultPrevented 即可知网页有没有处理;
//   - 网页没处理的 dragover 由我们 preventDefault,drop 才会派发且不触发 file:// 导航;
//   - 网页没处理的 drop,若文件类型可识别就交给主进程按默认动作在新标签打开,
//     否则不拦,保持 Chromium 默认行为。
// 网页 iframe 内没有 preload(nodeIntegrationInSubFrames:false),子帧心跳见下方
// message 监听。

const HEARTBEAT_MS = 150;

// dragleave 后这么久没有新的 dragover 才视为离开(Chromium 的 dragleave
// relatedTarget 常为 null,元素间移动也会触发;dragover 静止时约 50ms 一次)。
const LEAVE_GRACE_MS = 120;

const isExternalFileDrag = (event: DragEvent) => {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
};

// 原生就能接收文件拖放的元素:<input type=file>、可编辑区域。Chromium 只有在 DOM
// 未拦截 dragover/drop 时才会把文件交给它们,这里一律不碰。
const isNativeDropTarget = (event: DragEvent) => {
  const node = (event.composedPath?.()[0] || event.target) as Element | null;
  if (!node || typeof (node as any).closest !== 'function') return false;
  if (node.closest('input[type="file" i]')) return true;
  if (node.closest('textarea')) return true;
  return !!(node as HTMLElement).isContentEditable;
};

export const installFileDragBridge = (windowId: number) => {
  if (!windowId) return;

  // 本文档内发起的拖拽(拖网页里的图片/链接)也会带 Files 类型,不能当外部文件。
  let internalDrag = false;
  let active = false;
  let lastBeatAt = 0;
  let pendingTail: {type: string; fn: (e: Event) => void} | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelLeave = () => {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  const send = (payload: {active: boolean; name?: string; mime?: string}) => {
    try {
      ipcRenderer.send(`page-file-drag-${windowId}`, payload);
    } catch {
      // 页面卸载中,忽略。
    }
  };

  const deactivate = () => {
    cancelLeave();
    if (!active) return;
    active = false;
    lastBeatAt = 0;
    send({active: false});
  };

  const beat = (event: DragEvent) => {
    const now = Date.now();
    if (active && now - lastBeatAt < HEARTBEAT_MS) return;
    active = true;
    lastBeatAt = now;
    const file = event.dataTransfer?.files?.[0];
    const item = Array.from(event.dataTransfer?.items || []).find(
      (it) => it.kind === 'file',
    );
    send({
      active: true,
      name: file?.name || '',
      mime: item?.type || '',
    });
  };

  // 在本次派发末尾运行 fn。网页 stopPropagation 时它不会触发,下次挂新的前摘掉。
  const runAfterPage = (type: string, fn: (e: DragEvent) => void) => {
    if (pendingTail) {
      window.removeEventListener(pendingTail.type, pendingTail.fn);
    }
    const tail = (e: Event) => {
      pendingTail = null;
      fn(e as DragEvent);
    };
    pendingTail = {type, fn: tail};
    window.addEventListener(type, tail, {once: true});
  };

  window.addEventListener(
    'dragstart',
    () => {
      internalDrag = true;
    },
    true,
  );
  window.addEventListener(
    'dragend',
    () => {
      internalDrag = false;
      deactivate();
    },
    true,
  );

  window.addEventListener(
    'dragover',
    (event) => {
      if (internalDrag || !isExternalFileDrag(event)) return;
      cancelLeave();
      beat(event);
      if (isNativeDropTarget(event)) return;
      runAfterPage('dragover', (e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
    },
    true,
  );

  window.addEventListener(
    'dragleave',
    (event) => {
      // 可能只是元素间移动,宽限期内没有新 dragover 才算离开窗口/进入 iframe。
      if (!active || event.relatedTarget) return;
      cancelLeave();
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        deactivate();
      }, LEAVE_GRACE_MS);
    },
    true,
  );

  window.addEventListener(
    'drop',
    (event) => {
      if (internalDrag || !isExternalFileDrag(event)) {
        internalDrag = false;
        return;
      }
      deactivate();
      if (isNativeDropTarget(event)) return;
      runAfterPage('drop', (e) => {
        if (e.defaultPrevented) return;
        const filePaths: string[] = [];
        for (const file of Array.from(e.dataTransfer?.files || [])) {
          let filePath = '';
          try {
            filePath = webUtils.getPathForFile(file);
          } catch {
            filePath = '';
          }
          if (filePath && getHeaderDropFileType(filePath)) {
            filePaths.push(filePath);
          }
        }
        if (filePaths.length === 0) return;
        e.preventDefault();
        ipcRenderer.send(`page-file-drop-${windowId}`, filePaths);
      });
    },
    true,
  );

  // 子帧(含主页整页的 pcapp 跨源 iframe)没有 preload,由主进程注入的
  // file-drag-subframe 脚本经 window.top.postMessage 转来拖拽状态。子帧里的松手
  // 若网页没接管,会变成主框架 file:// 导航,由主进程 View 结合心跳拦截。
  window.addEventListener('message', (event) => {
    if (event.source === window) return;
    const data = (event.data as any)?.[PAGE_FILE_DRAG_MESSAGE_KEY];
    if (!data || typeof data !== 'object') return;
    if (data.type === 'over') {
      cancelLeave();
      if (active && Date.now() - lastBeatAt < HEARTBEAT_MS) return;
      active = true;
      lastBeatAt = Date.now();
      send({
        active: true,
        name: typeof data.name === 'string' ? data.name : '',
        mime: typeof data.mime === 'string' ? data.mime : '',
      });
    } else if (data.type === 'drop') {
      // 子帧脚本只在子帧网页未接管时才带 files;路径与类型由这里和主进程再校验。
      const wasActive = active;
      deactivate();
      if (!wasActive || !Array.isArray(data.files)) return;
      const filePaths: string[] = [];
      for (const file of data.files) {
        if (!(file instanceof File)) continue;
        let filePath = '';
        try {
          filePath = webUtils.getPathForFile(file);
        } catch {
          filePath = '';
        }
        if (filePath && getHeaderDropFileType(filePath)) filePaths.push(filePath);
      }
      if (filePaths.length > 0) {
        ipcRenderer.send(`page-file-drop-${windowId}`, filePaths);
      }
    } else if (data.type === 'end' && active) {
      // 可能只是从子帧移到顶层文档,宽限期内顶层 dragover 会取消它。
      cancelLeave();
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        deactivate();
      }, LEAVE_GRACE_MS);
    }
  });

  window.addEventListener('pagehide', deactivate);
};
