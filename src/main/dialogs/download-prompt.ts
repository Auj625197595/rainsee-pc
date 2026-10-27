import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, statSync } from 'fs';
import { IDownloadPromptData, IDownloadPromptResult } from '~/interfaces';
import { PersistentDialog } from './dialog';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';

const WIDTH = 440;
const HEIGHT = 404;

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

// 浮层被外部关闭(切标签/点网页触发 hideAllPersistent,或浮层加载/显示失败)
// 时使用:用户点了网页上的"下载"就是要这个文件,外部关闭按默认名/目录继续
// 下载,绝不静默杀任务;只有浮层上的"取消"按钮/Esc 才真正取消。
const dismissedResult = (data?: IDownloadPromptData): IDownloadPromptResult => ({
  action: 'dismiss',
  fileName: data?.fileName ?? '',
  directory: data?.directory ?? '',
  downloaderType: 'browser',
});

// 校验回执与原生目录选择标题按当前语言即时翻译。
const promptTranslator = () =>
  getMainTranslator(Application.instance.settings?.object?.language);

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
        title: promptTranslator()('dlpChooseLocation'),
        defaultPath: current.data.directory,
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? '' : result.filePaths[0] || '';
    });

    ipcMain.handle(
      submitChannel,
      async (_event, result: IDownloadPromptResult) => {
        if (!this.current) return { ok: false, message: promptTranslator()('dlpTaskExpired') };

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
          return { ok: false, message: promptTranslator()('dlpInvalidName') };
        }

        let validDirectory = false;
        try {
          validDirectory =
            existsSync(directory) && statSync(directory).isDirectory();
        } catch {
          validDirectory = false;
        }
        if (!validDirectory) {
          return { ok: false, message: promptTranslator()('dlpInvalidLocation') };
        }

        const downloaderType = String(result?.downloaderType || 'browser');
        const allowedDownloaders = new Set([
          'browser',
          ...this.current.data.downloaders.map((item) => item.type),
        ]);
        if (!allowedDownloaders.has(downloaderType)) {
          return { ok: false, message: promptTranslator()('dlpDownloaderUnavailable') };
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

  // 外部关闭(切标签/点网页的 hideAllPersistent)不走取消:finishCurrent 按-dismiss
  // 结束当前询问,下载继续。窗口已销毁(onWindowClosed)除外,那种情况宿主 view
  // 会随窗口销毁,任务本身也活不下去。
  public hide(bringToTop = false, hideVisually = true) {
    if (this.current) {
      this.finishCurrent(dismissedResult(this.current.data));
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
      // show 返回 false = 等待冷加载期间被 hide 顶掉/宿主窗口销毁。不能就此
      // 返回:current 悬空会让下载项永久停在暂停态,队列也被卡死。按外部关闭
      // 收尾(下载继续),finishCurrent 对 current 已被 hide 清空的情况是幂等的。
      if (!(await super.show(next.browserWindow, true))) {
        this.finishCurrent(dismissedResult(next.data));
        return;
      }
      this.rearrange();
      next.browserWindow.on('resize', this.onWindowResize);
      next.browserWindow.once('closed', this.onWindowClosed);
      this.send('visible', true, next.data);
    } catch {
      this.finishCurrent(dismissedResult(next.data));
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
