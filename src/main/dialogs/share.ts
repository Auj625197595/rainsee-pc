import {BrowserWindow, ipcMain, dialog} from 'electron';
import * as fs from 'fs';
import * as QRCode from 'qrcode';
import {Application} from '../application';
import {PersistentDialog} from './dialog';
import {getMainTranslator} from '../i18n';

const WIDTH = 392;
const HEIGHT = 620;

// 二维码:本地离线生成 PNG data URL
const createQrcode = (text: string): Promise<string> =>
  QRCode.toDataURL(text, {
    margin: 2,
    width: 480,
    errorCorrectionLevel: 'M',
    color: {dark: '#000000', light: '#ffffff'},
  });

export class ShareDialog extends PersistentDialog {
  public constructor() {
    super({
      name: 'share',
      bounds: {width: WIDTH, height: HEIGHT},
    });

    const generateChannel = `share-generate-${this.id}`;
    const downloadChannel = `share-download-qr-${this.id}`;
    this.ipcChannels.push(generateChannel, downloadChannel);

    // 渲染层请求生成二维码(本地离线生成,结果回推)
    ipcMain.on(generateChannel, async (e, url: string) => {
      try {
        const qr = await createQrcode(url);
        this.send('share-result', {
          qrUrl: qr,
          qrError: false,
          shortUrl: '',
          shortError: false,
        });
      } catch (err) {
        this.send('share-result', {
          qrUrl: '',
          qrError: true,
          shortUrl: '',
          shortError: false,
        });
      }
    });

    // 渲染层请求下载二维码:qrUrl 为本地生成的 data URL,直接解码 base64 写盘(不联网)
    ipcMain.on(downloadChannel, async (e, qrUrl: string) => {
      try {
        if (!qrUrl) throw new Error('empty');
        const m = /^data:image\/(\w+);base64,(.+)$/.exec(qrUrl);
        if (!m) throw new Error('invalid_data_url');
        const ext = m[1].toLowerCase();
        const buf = Buffer.from(m[2], 'base64');
        const t = getMainTranslator(
          Application.instance.settings?.object?.language,
        );
        const {canceled, filePath} = await dialog.showSaveDialog(this.browserWindow, {
          title: t('shareSaveQr'),
          defaultPath: `qrcode.${ext}`,
          filters: [{name: t('fileFilterImages'), extensions: [ext]}],
        });
        if (canceled || !filePath) {
          this.send('share-download-result', {ok: false, canceled: true});
          return;
        }
        await fs.promises.writeFile(filePath, buf);
        this.send('share-download-result', {ok: true});
      } catch (err) {
        this.send('share-download-result', {ok: false, canceled: false});
      }
    });
  }

  // 屏幕(窗口内容区)居中
  public rearrange() {
    const { width, height } = this.browserWindow.getContentBounds();
    super.rearrange({
      x: Math.round((width - WIDTH) / 2),
      y: Math.round((height - HEIGHT) / 2),
      width: WIDTH,
      height: HEIGHT,
    });
  }

  private onBoundsUpdate = () => this.hide();

  // payload 由标签右键菜单传入(分享指定标签页,不切换选中);
  // 未传时回退到当前选中标签页(QuickMenu 入口)。
  public async open(
    browserWindow: BrowserWindow,
    payload?: { url?: string; title?: string },
  ) {
    const selected = Application.instance.windows.current.viewManager.selected;
    const url = (payload && payload.url) || selected.url;
    const title = (payload && payload.title) || selected.title;

    if (!(await super.show(browserWindow, true))) return;

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    this.send('visible', true, {url, title});
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
