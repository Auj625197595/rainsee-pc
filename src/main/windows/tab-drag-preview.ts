import {BrowserWindow, ipcMain} from 'electron';

// 标签撕离时跟随光标的轻量预览(标题+图标)。一个全局单例的无边框、透明、
// 不抢焦点、置顶的小窗口。仅作视觉反馈,松手即隐藏;真正的建窗/合并由
// windows-service 的 tab-drag-detach 处理。

const WIDTH = 232;
const HEIGHT = 44;

let previewWin: BrowserWindow | null = null;

const buildHtml = (title: string, favicon: string) => {
  const safeTitle = (title || '新标签页')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const icon =
    favicon && favicon.startsWith('http')
      ? favicon
      : favicon || '';
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;overflow:hidden;background:transparent;}
      .card{display:flex;align-items:center;gap:8px;height:${HEIGHT - 8}px;
        margin:4px;padding:0 12px;border-radius:8px;
        background:rgba(255,255,255,0.98);
        box-shadow:0 6px 20px rgba(0,0,0,0.22);
        font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:#202124;
        white-space:nowrap;}
      .fav{width:16px;height:16px;flex:0 0 16px;border-radius:3px;}
      .t{overflow:hidden;text-overflow:ellipsis;}
    </style></head><body>
      <div class="card">
        ${icon ? `<img class="fav" src="${icon}"/>` : `<div class="fav"></div>`}
        <div class="t">${safeTitle}</div>
      </div>
    </body></html>`)}`;
};

const ensureWindow = () => {
  if (previewWin && !previewWin.isDestroyed()) return previewWin;
  previewWin = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      // 纯静态展示,无需任何脚本能力。
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  previewWin.setIgnoreMouseEvents(true);
  return previewWin;
};

export const setupTabDragPreview = () => {
  ipcMain.on('tab-drag-preview-show', (e, payload) => {
    const {title, favicon, screenX, screenY} = payload || {};
    const win = ensureWindow();
    win.loadURL(buildHtml(title, favicon));
    win.setPosition(Math.round(screenX) + 12, Math.round(screenY) + 12);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.showInactive();
  });

  ipcMain.on('tab-drag-preview-move', (e, screenX, screenY) => {
    if (!previewWin || previewWin.isDestroyed() || !previewWin.isVisible()) {
      return;
    }
    previewWin.setPosition(Math.round(screenX) + 12, Math.round(screenY) + 12);
  });

  ipcMain.on('tab-drag-preview-hide', () => {
    if (previewWin && !previewWin.isDestroyed() && previewWin.isVisible()) {
      previewWin.hide();
    }
  });
};
