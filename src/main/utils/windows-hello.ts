// Windows Hello 身份验证(PIN / 指纹 / 人脸)。
//
// 实现:用 PowerShell 调用 WinRT 的 UserConsentVerifier.RequestVerificationAsync,
// 与 Edge / Chrome 导出密码前的「Windows 安全中心」验证流程一致。
// 走 -EncodedCommand(UTF-16LE base64)传中文提示,避免 GBK 控制台乱码。
//
// 返回码(UserConsentVerificationResult):
//   0 Verified            1 DeviceNotPresent    2 NotConfiguredForUser
//   3 DisabledByPolicy    4 RetriesExhausted    5 Canceled

import { spawn } from 'child_process';

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

// PowerShell 脚本:加载 WinRT,异步等待 RequestVerificationAsync,输出结果码。
// 占位符 __REASON__ 在运行前替换(reason 单引号转义)。
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asmTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  function AwaitOp($op, $t) {
    $task = $asmTask.MakeGenericMethod($t).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }
  [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('__REASON__')
  $r = AwaitOp $op ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  Write-Output $r.Value__
} catch {
  Write-Output ('ERR:' + ($_.Exception.Message -replace "[\\r\\n]+", ' '))
}
`;

export function verifyWindowsHello(reason: string): Promise<IHelloResult> {
  // 非 Windows 平台直接放行(开发环境 / 跨平台兼容)
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: true, result: 0, msg: '非 Windows 平台,跳过验证' });
  }

  // 单引号转义(PowerShell 单引号字符串里 ' → ''),防注入
  const safeReason = (reason || '').replace(/'/g, "''");
  const script = SCRIPT.replace(/__REASON__/g, safeReason);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true },
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
