import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, statSync } from 'fs';
import { IDownloadPromptData, IDownloadPromptResult } from '~/interfaces';
import { PersistentDialog } from './dialog';

const WIDTH = 430;
const HEIGHT = 382;

interface IPromptQueueItem {
  browserWindow: BrowserWindow;
  data: IDownloadPromptData;
  resolve: (result: IDownloadPromptResult) => void;
}

const canceledResult = (): IDownloadPromptResult => ({
  action: 'cancel',
  fileName: '',
  directory: '',
  downloaderType: 'browser',
});

// will-download 中暂停的任务由单个持久浮层串行处理，避免并发下载互相覆盖。
export class DownloadPromptDialog extends PersistentDialog {
  private queue: IPromptQueueItem[] = [];
  private current: IPromptQueueItem | null = null;

  public constructor() {
    super({
      name: 'download-prompt',
      bounds: { width: WIDTH, height: HEIGHT },
    });

    const selectDirectoryChannel = `download-prompt-select-directory-${this.id}`;
    const submitChannel = `download-prompt-submit-${this.id}`;
    this.ipcChannels.push(selectDirectoryChannel, submitChannel);

    ipcMain.handle(selectDirectoryChannel, async () => {
      const current = this.current;
      if (!current || current.browserWindow.isDestroyed()) return '';
      const result = await dialog.showOpenDialog(current.browserWindow, {
        title: '选择下载位置',
        defaultPath: current.data.directory,
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? '' : result.filePaths[0] || '';
    });

    ipcMain.handle(
      submitChannel,
      async (_event, result: IDownloadPromptResult) => {
        if (!this.current) return { ok: false, message: '下载任务已失效' };

        if (result?.action === 'cancel') {
          this.finishCurrent(canceledResult());
          return { ok: true };
        }

        const fileName = String(result?.fileName || '').trim();
        const directory = String(result?.directory || '').trim();
        const invalidName =
          !fileName ||
          /[<>:"/\\|?*\x00-\x1f]/.test(fileName) ||
          /[. ]$/.test(fileName) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(fileName);
        if (invalidName) {
          return { ok: false, message: '请输入有效的文件名' };
        }

        let validDirectory = false;
        try {
          validDirectory =
            existsSync(directory) && statSync(directory).isDirectory();
        } catch {
          validDirectory = false;
        }
        if (!validDirectory) {
          return { ok: false, message: '请选择有效的存储位置' };
        }

        const downloaderType = String(result?.downloaderType || 'browser');
        const allowedDownloaders = new Set([
          'browser',
          ...this.current.data.downloaders.map((item) => item.type),
        ]);
        if (!allowedDownloaders.has(downloaderType)) {
          return { ok: false, message: '所选下载器当前不可用' };
        }

        this.finishCurrent({
          action: result.action === 'open' ? 'open' : 'save',
          fileName,
          directory,
          downloaderType,
        });
        return { ok: true };
      },
    );
  }

  public prompt(
    browserWindow: BrowserWindow,
    data: IDownloadPromptData,
  ): Promise<IDownloadPromptResult> {
    return new Promise((resolve) => {
      this.queue.push({ browserWindow, data, resolve });
      this.showNext();
    });
  }

  public rearrange() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const { width, height } = this.browserWindow.getContentBounds();
    super.rearrange({
      x: Math.max(0, Math.round((width - WIDTH) / 2)),
      y: Math.max(48, Math.round((height - HEIGHT) / 2)),
      width: WIDTH,
      height: HEIGHT,
    });
  }

  public hide(bringToTop = false, hideVisually = true) {
    if (this.current) {
      this.finishCurrent(canceledResult());
      return;
    }
    super.hide(bringToTop, hideVisually);
  }

  private onWindowResize = () => this.rearrange();
  private onWindowClosed = () => this.finishCurrent(canceledResult());

  private async showNext() {
    if (this.current) return;

    const next = this.queue.shift();
    if (!next) return;
    if (next.browserWindow.isDestroyed()) {
      next.resolve(canceledResult());
      this.showNext();
      return;
    }

    this.current = next;
    try {
      if (!(await super.show(next.browserWindow, true))) return;
      this.rearrange();
      next.browserWindow.on('resize', this.onWindowResize);
      next.browserWindow.once('closed', this.onWindowClosed);
      this.send('visible', true, next.data);
    } catch {
      this.finishCurrent(canceledResult());
    }
  }

  private finishCurrent(result: IDownloadPromptResult) {
    const current = this.current;
    if (!current) return;

    current.browserWindow.removeListener('resize', this.onWindowResize);
    current.browserWindow.removeListener('closed', this.onWindowClosed);
    this.send('visible', false);
    super.hide(false, false);
    this.current = null;
    current.resolve(result);
    setTimeout(() => this.showNext(), 0);
  }
}
