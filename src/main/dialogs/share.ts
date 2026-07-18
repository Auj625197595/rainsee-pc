import {BrowserWindow, ipcMain, dialog} from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import {createHash} from 'crypto';
import * as QRCode from 'qrcode';
import {Application} from '../application';
import {PersistentDialog} from './dialog';

const WIDTH = 392;
const HEIGHT = 620;

// 短链签名:与安卓/boxv8 原版一致 sign=MD5(url), key=MD5(sign+"jiangyuting")
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

// 主进程发起 POST(application/x-www-form-urlencoded),规避弹窗 file:// 的 CORS
const postForm = (url: string, form: Record<string, string>): Promise<string> =>
  new Promise((resolve, reject) => {
    const body = Object.keys(form)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`)
      .join('&');
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

const API = 'https://api.yjllq.com/index.php/api';

// 二维码:本地离线生成 PNG data URL(引入 qrcode 库,不再联网调 QrcodeByNet)
const createQrcode = (text: string): Promise<string> =>
  QRCode.toDataURL(text, {
    margin: 2,
    width: 480,
    errorCorrectionLevel: 'M',
    color: {dark: '#000000', light: '#ffffff'},
  });

// 短链:POST Initv3/getDuanLian {key,url,sign} -> 直接返回短链字符串
const createShortUrl = async (url: string): Promise<string> => {
  const sign = md5(url);
  const key = md5(`${sign}jiangyuting`);
  const raw = await postForm(`${API}/Initv3/getDuanLian`, {key, url, sign});
  const short = `${raw}`.replace(/"/g, '').replace(/\\/g, '').trim();
  if (!short || !/^https?:\/\//.test(short)) throw new Error('short_url_failed');
  return short;
};

export class ShareDialog extends PersistentDialog {
  public constructor() {
    super({
      name: 'share',
      bounds: {width: WIDTH, height: HEIGHT},
    });

    // 渲染层请求生成二维码 + 短链(主进程发起,结果回推)
    ipcMain.on(`share-generate-${this.id}`, async (e, url: string) => {
      const [qr, short] = await Promise.allSettled([
        createQrcode(url),
        createShortUrl(url),
      ]);
      this.send('share-result', {
        qrUrl: qr.status === 'fulfilled' ? qr.value : '',
        qrError: qr.status === 'rejected',
        shortUrl: short.status === 'fulfilled' ? short.value : '',
        shortError: short.status === 'rejected',
      });
    });

    // 渲染层请求下载二维码:qrUrl 现为本地生成的 data URL,直接解码 base64 写盘(不联网)
    ipcMain.on(`share-download-qr-${this.id}`, async (e, qrUrl: string) => {
      try {
        if (!qrUrl) throw new Error('empty');
        const m = /^data:image\/(\w+);base64,(.+)$/.exec(qrUrl);
        if (!m) throw new Error('invalid_data_url');
        const ext = m[1].toLowerCase();
        const buf = Buffer.from(m[2], 'base64');
        const {canceled, filePath} = await dialog.showSaveDialog(this.browserWindow, {
          title: '保存二维码',
          defaultPath: `qrcode.${ext}`,
          filters: [{name: '图片', extensions: [ext]}],
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

    await super.show(browserWindow, true, false);

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
