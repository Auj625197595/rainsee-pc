// Windows 敏感操作的通用身份验证入口。
//
// 优先使用 Windows Hello(PIN / 指纹 / 人脸)。设备不支持、未配置或被策略禁用
// Hello 时，回退到「Windows 安全中心」账户密码框(CredUIPromptForWindowsCredentials
// + LogonUser 校验为当前用户),与 Chrome / Edge 的做法一致。
//
// 曾用锁屏(LockWorkStation)当兜底：用户点小眼睛后屏幕直接被锁、毫无提示，
// 且 Hello 脚本的技术故障(-1)也会落到锁屏，已废弃。

import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { Application } from '../application';
import { getMainTranslator } from '../i18n';
import type { Translator } from '~/common/i18n';
import { helloResultMessage, verifyWindowsHello } from './windows-hello';

export type WindowsUserVerificationMethod =
  | 'windows-hello'
  | 'windows-password'
  | 'skipped';

export interface IWindowsUserVerificationResult {
  ok: boolean;
  result: number;
  msg: string;
  method: WindowsUserVerificationMethod;
}

let activeVerification: Promise<IWindowsUserVerificationResult> | null = null;

function resolveCredentialScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'win-credential.ps1')
    : join(app.getAppPath(), 'static', 'win-credential.ps1');
}

// 只在 Hello 确实不可用时回退到账户密码:1 设备不支持 / 2 未配置 / 3 策略禁用。
// 脚本故障(-1)、设备忙、取消、重试耗尽都直接报错，不能靠回退绕过或掩盖。
function shouldUsePasswordPrompt(result: number): boolean {
  return result === 1 || result === 2 || result === 3;
}

// 凭据框的 owner 窗口：让系统把对话框挂在浏览器窗口上(居中、置前)。
function ownerHwnd(): string {
  const win =
    BrowserWindow.getFocusedWindow() || Application.instance?.windows?.current?.win;
  if (!win || win.isDestroyed()) return '';
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8
    ? buf.readBigUInt64LE(0).toString()
    : buf.readUInt32LE(0).toString();
}

function verifyWindowsPassword(
  reason: string,
  t: Translator,
): Promise<IWindowsUserVerificationResult> {
  const fail = (msg: string): IWindowsUserVerificationResult => ({
    ok: false,
    result: -1,
    msg,
    method: 'windows-password',
  });

  const scriptPath = resolveCredentialScriptPath();
  if (!existsSync(scriptPath)) {
    console.warn('[hello] credential script missing:', scriptPath);
    return Promise.resolve(fail(t('wvCredScriptMissing')));
  }

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        env: {
          ...process.env,
          RAINSEE_CRED_CAPTION: t('wvCredCaption'),
          RAINSEE_CRED_MESSAGE: reason || '',
          RAINSEE_CRED_HWND: ownerHwnd(),
        },
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8');
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
    });
    child.on('error', (error) => {
      console.warn('[hello] credential prompt launch failed:', error.message);
      resolve(fail(`${t('wvCredLaunchFailed')}:${error.message}`));
    });
    child.on('close', (code) => {
      const output = stdout.trim();
      console.log(
        `[hello] credential prompt exit=${code} out=${JSON.stringify(output)}` +
          (stderr.trim() ? ` stderr=${JSON.stringify(stderr.trim())}` : ''),
      );
      if (output.startsWith('ERR:')) {
        resolve(fail(output.slice(4)));
        return;
      }
      const match = output.match(/-?\d+/);
      if (!match) {
        const detail = stderr.trim() || output;
        resolve(fail(t('wvCredLaunchFailed') + (detail ? `:${detail}` : '')));
        return;
      }
      const num = parseInt(match[0], 10);
      resolve({
        ok: num === 0,
        result: num,
        msg: helloResultMessage(num, t),
        method: 'windows-password',
      });
    });
  });
}

async function performVerification(
  reason: string,
): Promise<IWindowsUserVerificationResult> {
  const t = getMainTranslator(Application.instance?.settings?.object?.language);
  const hello = await verifyWindowsHello(reason);

  if (hello.ok) {
    return {
      ...hello,
      method: process.platform === 'win32' ? 'windows-hello' : 'skipped',
    };
  }
  if (!shouldUsePasswordPrompt(hello.result)) {
    return { ...hello, method: 'windows-hello' };
  }

  return verifyWindowsPassword(reason, t);
}

/**
 * 验证当前操作系统用户后再执行敏感操作。并发调用复用同一次系统验证，避免弹出
 * 多个验证窗口。
 */
export function verifyWindowsUser(
  reason: string,
): Promise<IWindowsUserVerificationResult> {
  if (activeVerification) return activeVerification;

  activeVerification = performVerification(reason).finally(() => {
    activeVerification = null;
  });
  return activeVerification;
}
