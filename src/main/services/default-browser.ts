import { app, ipcMain, shell } from 'electron';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { makeId } from '~/utils';

// 程序内部使用的 ASCII 安全标识(注册表键名/ProgId 不用中文,避免路径问题)。
// 展示名称仍用中文,见 DISPLAY_NAME。
const APP_REG_KEY = 'RainseeBrowser';
const PROG_ID = 'RainseeBrowserHTML';
const DISPLAY_NAME = '雨见浏览器';
const DISPLAY_DESC = '雨见浏览器';

// 需要抢占的协议 / 文件类型。
const PROTOCOLS = ['http', 'https'];

const isWin = process.platform === 'win32';

// 开发模式下 process.execPath 是 electron.exe,注册它没有意义(用户重启后路径失效),
// 因此开发模式只走 Electron API,不写注册表。
const isDev = process.env.NODE_ENV === 'development';

const exePath = () => process.execPath;

/**
 * 查询当前是否已是默认浏览器。
 * 以 http 协议是否指向本应用为准(Win/Mac/Linux 通用)。
 */
export const isDefaultBrowser = (): boolean => {
  try {
    return PROTOCOLS.every((p) => app.isDefaultProtocolClient(p));
  } catch (e) {
    return false;
  }
};

/**
 * 生成 Windows 注册表内容(.reg)。写入 HKCU,无需管理员权限。
 * 关键结构:
 *  - Clients\StartMenuInternet\<APP> : 浏览器客户端声明 + Capabilities
 *  - Classes\<ProgId>                : HTML/URL 关联的 ProgId(图标 + 打开命令)
 *  - RegisteredApplications          : 把本应用注册进系统“默认应用”列表
 * 这样应用才会出现在 Win10/11 “默认应用 > 网页浏览器” 选择器里。
 */
const buildRegContent = (): string => {
  const exe = exePath().replace(/\\/g, '\\\\');
  const openCmd = `\\"${exe}\\" \\"%1\\"`;
  const iconRef = `${exe},0`;

  // .reg 文件格式:键名路径(方括号内)用「单」反斜杠作分隔符;字符串值里的反斜杠
  // 才需要转义成「双」。故下面键名一律用 JS 的 `\\`(→ 文件里单个 `\`),
  // 字符串值里的路径用 `\\\\`(→ 文件里 `\\`)。此前键名误用 `\\\\` 生成 `\\`,
  // `reg import` 报「无法导入注册表文件」退出码 1 → 设为默认按钮点了没反应。
  const capBase = `HKEY_CURRENT_USER\\Software\\Clients\\StartMenuInternet\\${APP_REG_KEY}`;
  const classBase = `HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}`;

  const lines: string[] = [];
  lines.push('Windows Registry Editor Version 5.00');
  lines.push('');

  // ── StartMenuInternet 客户端声明 ──
  lines.push(`[${capBase}]`);
  lines.push(`@="${DISPLAY_NAME}"`);
  lines.push('');
  lines.push(`[${capBase}\\DefaultIcon]`);
  lines.push(`@="${iconRef}"`);
  lines.push('');
  lines.push(`[${capBase}\\shell\\open\\command]`);
  lines.push(`@="${openCmd}"`);
  lines.push('');

  // ── Capabilities:声明本应用能处理哪些协议/文件类型 ──
  lines.push(`[${capBase}\\Capabilities]`);
  lines.push(`"ApplicationName"="${DISPLAY_NAME}"`);
  lines.push(`"ApplicationDescription"="${DISPLAY_DESC}"`);
  lines.push(`"ApplicationIcon"="${iconRef}"`);
  lines.push('');

  lines.push(`[${capBase}\\Capabilities\\StartMenu]`);
  lines.push(`"StartMenuInternet"="${APP_REG_KEY}"`);
  lines.push('');

  lines.push(`[${capBase}\\Capabilities\\URLAssociations]`);
  for (const p of PROTOCOLS) {
    lines.push(`"${p}"="${PROG_ID}"`);
  }
  lines.push('');

  lines.push(`[${capBase}\\Capabilities\\FileAssociations]`);
  lines.push(`".htm"="${PROG_ID}"`);
  lines.push(`".html"="${PROG_ID}"`);
  lines.push(`".pdf"="${PROG_ID}"`);
  lines.push('');

  // ── ProgId:URL/文件如何被打开 ──
  lines.push(`[${classBase}]`);
  lines.push(`@="${DISPLAY_NAME} HTML Document"`);
  lines.push('');
  lines.push(`[${classBase}\\DefaultIcon]`);
  lines.push(`@="${iconRef}"`);
  lines.push('');
  lines.push(`[${classBase}\\shell\\open\\command]`);
  lines.push(`@="${openCmd}"`);
  lines.push('');

  // ── 注册进系统“默认应用”列表(此处是字符串值,路径需双反斜杠)──
  lines.push('[HKEY_CURRENT_USER\\Software\\RegisteredApplications]');
  lines.push(
    `"${APP_REG_KEY}"="Software\\\\Clients\\\\StartMenuInternet\\\\${APP_REG_KEY}\\\\Capabilities"`,
  );
  lines.push('');

  return lines.join('\r\n');
};

/**
 * 写入并导入 .reg 文件。reg 文件用 UTF-16LE(含 BOM)编码以正确处理中文。
 */
const importRegistry = async (): Promise<void> => {
  const content = buildRegContent();
  const file = join(tmpdir(), `rainsee-default-${makeId(8)}.reg`);

  // UTF-16LE + BOM
  await fs.writeFile(file, '﻿' + content, { encoding: 'utf16le' as BufferEncoding });

  await new Promise<void>((resolve, reject) => {
    execFile('reg', ['import', file], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // 清理临时文件(best-effort)。
  fs.unlink(file).catch(() => undefined);
};

/**
 * 设为默认浏览器。
 * Win10/11 不允许程序静默抢占默认浏览器,因此:
 *   1. 写注册表声明 Capabilities(让应用出现在“默认应用”选择器);
 *   2. 调用 Electron 协议注册 API(覆盖部分旧场景);
 *   3. 打开系统“默认应用”设置,由用户手动确认。
 * 返回的 already 表示在执行后是否已检测到本应用为默认(部分系统会立即生效)。
 */
export const setAsDefaultBrowser = async (): Promise<{
  ok: boolean;
  already: boolean;
  error?: string;
}> => {
  // 注册表写入是 best-effort:它的作用只是让本应用(带正确名称/图标)出现在系统
  // “默认应用”选择器里。即便它失败,也必须继续打开系统设置页 —— 否则用户点了
  // 「设为默认」按钮看不到任何反应(此前 importRegistry 抛错被外层 catch 吞掉,
  // shell.openExternal 永远到不了)。
  let regError: string | undefined;

  if (isWin && !isDev) {
    try {
      await importRegistry();
    } catch (e: any) {
      regError = e?.message || String(e);
      console.warn('[default-browser] importRegistry failed:', regError);
    }
  }

  for (const p of PROTOCOLS) {
    try {
      app.setAsDefaultProtocolClient(p);
    } catch (e) {
      // 单个协议失败不阻断整体流程。
    }
  }

  if (isWin) {
    // 打开 Win10/11 “默认应用”设置页,引导用户选择本应用。
    shell.openExternal('ms-settings:defaultapps').catch(() => {
      // 旧系统回退:打开“设置默认程序”控制面板。
      execFile('control', ['/name', 'Microsoft.DefaultPrograms'], () => undefined);
    });
  }

  return { ok: true, already: isDefaultBrowser(), error: regError };
};

/**
 * 注册 IPC:供设置页查询状态 / 触发设为默认。
 */
export const registerDefaultBrowserIpc = () => {
  ipcMain.handle('get-default-browser-status', () => {
    return {
      isDefault: isDefaultBrowser(),
      // 开发模式无法可靠注册,前端据此给出提示。
      supported: !isDev,
      platform: process.platform,
    };
  });

  ipcMain.handle('set-as-default-browser', async () => {
    return await setAsDefaultBrowser();
  });
};
