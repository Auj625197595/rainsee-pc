import {app, nativeImage, shell} from 'electron';
import {writeFileSync, existsSync, mkdirSync, copyFileSync} from 'fs';
import {join, resolve} from 'path';

import {buildIcoFromPng} from './pwa';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';

// 无痕窗口的独立 AppUserModelID。Windows 任务栏按 AUMID 分组,
// 给无痕窗口单独的 AUMID 才能让它与主程序分开成两个任务栏按钮。
// 该 AUMID 还需通过开始菜单快捷方式(见 installIncognitoShortcut)向 Windows 注册,
// 用户右键任务栏 → 「固定到任务栏」才能钉出一个点击会用 --incognito 重新拉起的项。
export const INCOGNITO_AUMID = 'com.rainsee.pcbrowser.incognito';

const SIZE = 256;
const PNG_NAME = 'incognito-icon.png';
const ICO_NAME = 'incognito-icon.ico';

let cache: {pngPath: string; icoPath: string} | null = null;

// 在 userData 下生成「深色圆角底 + 白色侦探帽」图标(PNG + ICO),已存在则直接复用。
// 纯像素运算 + nativeImage,无新依赖;颜色取近灰/白,对 RGBA/BGRA 字节序差异不敏感。
// 生成结果质量为「简洁图标风」,日后可提交 static/icons/incognito.ico 替换。
const generateIconBuffers = (): {png: Buffer; ico: Buffer} => {
  const BG = [51, 50, 62]; // #33323e 深石板色
  const WHITE = [245, 245, 248];
  const BAND = [92, 90, 112]; // 帽带中灰

  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const setPx = (x: number, y: number, [r, g, b]: number[]) => {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  };
  const fillHLine = (y: number, cx: number, hw: number, c: number[]) => {
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) setPx(x, y, c);
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPx(x, y, c);
  };

  // 背景:整面不透明深色
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) setPx(x, y, BG);

  const cx = 128;
  // 帽冠:顶部半圆穹顶 center(128,86) r=34
  const cy = 86;
  const r = 34;
  for (let y = cy - r; y <= cy; y++) {
    const dy = y - cy;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    fillHLine(y, cx, hw, WHITE);
  }
  // 帽冠:梯形主体 y86→152,半宽 34→70
  for (let y = 86; y <= 152; y++) {
    const t = (y - 86) / (152 - 86);
    const hw = 34 + (70 - 34) * t;
    fillHLine(y, cx, hw, WHITE);
  }
  // 帽带:横跨帽冠底部
  fillRect(cx - 70, 144, cx + 70, 157, BAND);
  // 帽檐:椭圆 center(128,163) rx=92 ry=18
  const bx = 128;
  const by = 163;
  const rx = 92;
  const ry = 18;
  for (let y = by - ry; y <= by + ry; y++) {
    const dy = y - by;
    const v = 1 - (dy * dy) / (ry * ry);
    if (v < 0) continue;
    fillHLine(y, bx, rx * Math.sqrt(v), WHITE);
  }

  const img = nativeImage.createFromBitmap(buf, {width: SIZE, height: SIZE});
  const png = img.toPNG();
  const ico = buildIcoFromPng(png, SIZE, SIZE);
  return {png, ico};
};

// 幂等:确保有无痕图标可用,返回其路径(BrowserWindow icon 与 setAppDetails appIconPath
// 在 Windows 下都接受/推荐 .ico,故 pngPath/icoPath 指向同一 .ico)。
//
// 优先用仓库自带正式图标 static/icons/icon_inco.ico。打包后 static 在 app.asar 内,
// 而 Windows shell(setAppDetails / .lnk 图标)无法读 asar 路径,故把自带图标复制到
// userData(真实文件系统路径)再用。自带图标缺失时兜底运行时生成(深色+侦探帽)。
export const ensureIncognitoIcon = (): {pngPath: string; icoPath: string} => {
  if (cache) return cache;
  const dir = app.getPath('userData');
  const pngPath = join(dir, PNG_NAME);
  const icoPath = join(dir, ICO_NAME);
  const staticIco = resolve(app.getAppPath(), 'static', 'icons', 'icon_inco.ico');
  try {
    if (existsSync(staticIco)) {
      // 每次启动覆盖复制,保证图标随仓库更新而刷新。
      copyFileSync(staticIco, icoPath);
      cache = {pngPath: icoPath, icoPath};
      return cache;
    }
    // 兜底:仓库无自带图标 → 运行时生成。
    if (!existsSync(pngPath) || !existsSync(icoPath)) {
      const {png, ico} = generateIconBuffers();
      writeFileSync(pngPath, png);
      writeFileSync(icoPath, ico);
    }
  } catch (e) {
    console.error('[incognito-icon] ensure failed', e);
  }
  cache = {pngPath, icoPath};
  return cache;
};

// 幂等(仅 win32):在开始菜单写一个带独立 AUMID、指向 exe --incognito 的快捷方式。
// Windows 索引到该 AUMID 后,运行中的无痕窗口右键才会出现可用的「固定到任务栏」,
// 且固定项点击会用 --incognito 重新拉起无痕(对应 application.ts 的 --incognito 处理)。
export const installIncognitoShortcut = () => {
  if (process.platform !== 'win32') return;
  try {
    // 快捷方式文件名与描述对用户可见(开始菜单展示),按当前语言生成。
    const incognitoTitle = getMainTranslator(
      Application.instance?.settings?.object?.language,
    )('incognitoTitle');
    const {icoPath} = ensureIncognitoIcon();
    const programs = join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
    );
    try {
      if (!existsSync(programs)) mkdirSync(programs, {recursive: true});
    } catch {
      // ignore
    }
    const lnkPath = join(programs, `${incognitoTitle}.lnk`);
    const details: Electron.ShortcutDetails = {
      target: process.execPath,
      args: '--incognito',
      description: incognitoTitle,
      icon: icoPath,
      iconIndex: 0,
      appUserModelId: INCOGNITO_AUMID,
    };
    const op: 'create' | 'update' = existsSync(lnkPath) ? 'update' : 'create';
    try {
      shell.writeShortcutLink(lnkPath, op, details);
    } catch (e) {
      // 'create' 在某些情况下已存在会抛错,回退 'update' 重写全部字段。
      shell.writeShortcutLink(lnkPath, 'update', details);
      console.log('[incognito-icon] writeShortcutLink retry update', e);
    }
  } catch (e) {
    console.error('[incognito-icon] installIncognitoShortcut failed', e);
  }
};
