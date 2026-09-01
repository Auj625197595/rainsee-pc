import { BrowserWindow, ipcMain, dialog, clipboard, nativeImage } from 'electron';
import * as fs from 'fs';
import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import { PersistentDialog } from './dialog';

// 全屏截图浮层:覆盖当前页面内容区,展示 1:1 页面快照供框选。
// 截取/保存/复制均在主进程完成,渲染层只负责交互与裁剪坐标(按比例)。
export class ScreenshotDialog extends PersistentDialog {
  public constructor() {
    super({
      name: 'screenshot',
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    });

    const saveChannel = `screenshot-save-${this.id}`;
    const copyChannel = `screenshot-copy-${this.id}`;
    const searchChannel = `screenshot-search-${this.id}`;
    const longshotChannel = `screenshot-longshot-${this.id}`;
    this.ipcChannels.push(
      saveChannel,
      copyChannel,
      searchChannel,
      longshotChannel,
    );

    // 渲染层就绪后请求:保存图片(弹原生保存框写盘)
    ipcMain.on(saveChannel, async (e, dataURL: string) => {
      console.log('[screenshot] SAVE handler dataURL.len=', dataURL?.length);
      try {
        const t = getMainTranslator(
          Application.instance.settings?.object?.language,
        );
        const img = nativeImage.createFromDataURL(dataURL);
        const { canceled, filePath } = await dialog.showSaveDialog(
          this.browserWindow,
          {
            title: t('shotSaveDialogTitle'),
            defaultPath: `screenshot-${this.stamp()}.png`,
            filters: [{ name: t('fileFilterImages'), extensions: ['png'] }],
          },
        );
        if (canceled || !filePath) {
          this.send('screenshot-save-result', { ok: false, canceled: true });
          return;
        }
        await fs.promises.writeFile(filePath, img.toPNG());
        this.send('screenshot-save-result', { ok: true });
      } catch (err) {
        console.log('[screenshot] SAVE handler threw:', (err as Error)?.message);
        this.send('screenshot-save-result', { ok: false, canceled: false });
      }
    });

    // 复制图片到剪贴板
    ipcMain.on(copyChannel, (e, dataURL: string) => {
      console.log('[screenshot] COPY handler dataURL.len=', dataURL?.length);
      try {
        clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
        this.send('screenshot-copy-result', { ok: true });
      } catch (err) {
        console.log('[screenshot] COPY handler threw:', (err as Error)?.message);
        this.send('screenshot-copy-result', { ok: false });
      }
    });

    ipcMain.on(searchChannel, (_e, dataURL: string) => {
      this.hide();
      void Application.instance.handleScreenshotImageAction('search', dataURL);
    });

    // 开源版：截图「问 AI」通道已移除。

    // 长截图:截取整张可滚动页面(CDP captureBeyondViewport)
    ipcMain.on(longshotChannel, async () => {
      console.log('[screenshot] LONGSHOT handler');
      try {
        const dataURL = await this.captureFullPage();
        this.send('screenshot-longshot-result', { ok: true, dataURL });
      } catch (err) {
        console.log('[screenshot] LONGSHOT handler threw:', (err as Error)?.message);
        this.send('screenshot-longshot-result', { ok: false });
      }
    });
  }

  private stamp() {
    // 主进程构造稳定时间戳(避免在渲染层拼接)
    const d = new Date();
    const p = (n: number) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours(),
    )}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // 用 CDP 截取整张页面(含视口外内容)。返回 PNG dataURL。
  private async captureFullPage(): Promise<string> {
    const view = Application.instance.windows.current.viewManager.selected;
    if (!view) throw new Error('no_selected_view');
    const wc = view.webContents;
    const dbg = wc.debugger;

    let attachedHere = false;
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      attachedHere = true;
    }

    try {
      const metrics: any = await dbg.sendCommand('Page.getLayoutMetrics');
      // 宽度取 CSS 布局视口宽(页面在屏幕上铺开的实际宽度),而非 contentSize.width——
      // 后者是整页可滚动内容宽度,当页面有横向溢出或居中布局时会大于可视宽度,用去截就会
      // 在两侧留下白边。高度仍取整页内容高度(截长图要含视口外的全部内容)。
      const layout = metrics.cssLayoutViewport || metrics.layoutViewport;
      const cssContent = metrics.cssContentSize || metrics.contentSize;
      const width = Math.ceil(layout?.clientWidth || cssContent.width);
      const height = Math.ceil(cssContent.height);
      console.log(
        '[screenshot] longshot metrics contentSize=',
        JSON.stringify(metrics.contentSize),
        'cssContentSize=',
        JSON.stringify(metrics.cssContentSize),
        'cssLayoutViewport.clientWidth=',
        metrics.cssLayoutViewport?.clientWidth,
        'layoutViewport.clientWidth=',
        metrics.layoutViewport?.clientWidth,
        '→ clip width=',
        width,
        'height=',
        height,
      );

      const { data } = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      });
      return `data:image/png;base64,${data}`;
    } finally {
      if (attachedHere && dbg.isAttached()) {
        try {
          dbg.detach();
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  // 覆盖当前选中标签页的内容区(与快照 1:1 对齐)。
  private pageBounds() {
    const view = Application.instance.windows.current.viewManager.selected;
    const b = view?.bounds;
    if (b && b.width && b.height) return b;
    // 兜底:整个窗口内容区
    const { width, height } = this.browserWindow.getContentBounds();
    return { x: 0, y: 0, width, height };
  }

  public rearrange() {
    super.rearrange(this.pageBounds());
  }

  private onBoundsUpdate = () => this.hide();

  public async open(browserWindow: BrowserWindow) {
    const view = Application.instance.windows.current.viewManager.selected;
    console.log('[screenshot] open called hasView=', !!view);
    if (!view) return;

    // 先抓取当前页快照(须在浮层覆盖前,且 BrowserView 仍可见时)
    let snapshot = '';
    try {
      const wc = view.webContents;
      const image = await wc.capturePage();
      const empty = image.isEmpty();
      const size = empty ? null : image.getSize();
      console.log(
        '[screenshot] capturePage empty=',
        empty,
        'size=',
        size ? `${size.width}x${size.height}` : 'null',
        'isLoading=',
        wc.isLoading(),
        'destroyed=',
        wc.isDestroyed(),
      );
      if (!empty) snapshot = image.toDataURL();
    } catch (e) {
      console.log('[screenshot] capturePage threw:', (e as Error)?.message);
      /* 抓取失败仍打开,渲染层显示纯遮罩 */
    }

    if (!(await super.show(browserWindow, true))) return;
    this.rearrange();

    browserWindow.removeListener('resize', this.onBoundsUpdate);
    browserWindow.removeListener('move', this.onBoundsUpdate);
    browserWindow.on('resize', this.onBoundsUpdate);
    browserWindow.on('move', this.onBoundsUpdate);

    console.log(
      '[screenshot] send visible snapshot.len=',
      snapshot.length,
      'webContentsId=',
      this.id,
    );
    this.send('visible', true, { snapshot });
  }

  public hide(bringToTop = false, hideVisually = true) {
    super.hide(bringToTop, hideVisually);
    if (this.browserWindow) {
      this.browserWindow.removeListener('resize', this.onBoundsUpdate);
      this.browserWindow.removeListener('move', this.onBoundsUpdate);
    }
  }
}
