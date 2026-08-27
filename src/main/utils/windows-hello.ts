// Windows Hello 身份验证(PIN / 指纹 / 人脸)。
//
// 实现:调用预置的明文 win-hello.ps1(`powershell.exe -File`),脚本再走 WinRT
// UserConsentVerifier.RequestVerificationAsync,与 Edge / Chrome 导出密码前的
// 「Windows 安全中心」验证流程一致。
//
// 为什么用 -File 而不是 -EncodedCommand:后者(base64 编码的 PowerShell payload)
// 是 360 QVM 等启发式引擎的高权重恶意软件特征,会让整个安装包被判为
// HEUR/QVM*.Malware.Gen。改用磁盘上的固定明文脚本 + 参数化 reason,形态从
// 「编码无文件执行」变为「带可审计脚本文件执行」,显著降低误报率。
//
// reason 经环境变量 RAINSEE_HELLO_REASON 传入(走 Unicode 环境块,避免命令行
// argv 在 PowerShell 5.1 下的中文编码坑)。
//
// 返回码(UserConsentVerificationResult):
//   0 Verified            1 DeviceNotPresent    2 NotConfiguredForUser
//   3 DisabledByPolicy    4 RetriesExhausted    5 Canceled

import { app } from 'electron';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

export interface IHelloResult {
  ok: boolean;
  result: number;
  msg: string;
}

const RESULT_MESSAGES: { [k: number]: string } = {
  0: '已验证',
  1: '当前设备不支持 Windows Hello',
  2: '未配置 Windows Hello,请先在「设置 - 账户 - 登录选项」中设置 PIN',
  3: 'Windows Hello 被组策略禁用',
  4: '验证失败次数过多',
  5: '已取消验证',
};

// 打包后脚本在 resources/win-hello.ps1(extraResources 解包到 asar 外,供外部进程读取);
// 开发时在项目 static/ 下。
function resolveScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'win-hello.ps1')
    : join(app.getAppPath(), 'static', 'win-hello.ps1');
}

export function verifyWindowsHello(reason: string): Promise<IHelloResult> {
  // 非 Windows 平台直接放行(开发环境 / 跨平台兼容)
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: true, result: 0, msg: '非 Windows 平台,跳过验证' });
  }

  const scriptPath = resolveScriptPath();
  if (!existsSync(scriptPath)) {
    return Promise.resolve({
      ok: false,
      result: -1,
      msg: 'Windows Hello 脚本缺失,请重装应用',
    });
  }

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        env: { ...process.env, RAINSEE_HELLO_REASON: reason || '' },
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        result: -1,
        msg: '无法启动 Windows Hello 验证:' + err.message,
      });
    });

    child.on('close', () => {
      const out = stdout.trim();
      if (out.startsWith('ERR:')) {
        resolve({ ok: false, result: -1, msg: out.slice(4) });
        return;
      }
      // 输出可能是单行数字,也可能掺杂 PS 对象名;取首个整数。
      const match = out.match(/-?\d+/);
      if (!match) {
        resolve({
          ok: false,
          result: -1,
          msg: 'Windows Hello 响应异常' + (stderr ? ':' + stderr.trim() : ''),
        });
        return;
      }
      const num = parseInt(match[0], 10);
      resolve({
        ok: num === 0,
        result: num,
        msg: RESULT_MESSAGES[num] || '验证未通过',
      });
    });
  });
}
