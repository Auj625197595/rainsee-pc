# Rainsee Browser - Windows Hello consent verification.
# Invoked by the main process: powershell.exe -NoProfile -ExecutionPolicy Bypass -File <this>
# Reason text flows in through RAINSEE_HELLO_REASON (Unicode-safe via the env block).
# Prints a single integer (UserConsentVerificationResult) or 'ERR:<message>'.
#
# This file is intentionally pure-ASCII on disk so encoding is unambiguous for
# PowerShell 5.1 (no BOM dependency). Localized UI strings live in the TS caller.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asmTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function AwaitOp($op, $t) {
    $task = $asmTask.MakeGenericMethod($t).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }
  # The consent UI ("Windows Security") is hosted by CredentialUIBroker.exe in a
  # top-level window of class 'Credential Dialog Xaml Host' - NOT by this
  # powershell process. Because the broker is launched from a hidden background
  # process chain, its window has no foreground activation rights and opens
  # BEHIND the browser window. Watch for that window class to appear, then:
  #  - AttachThreadInput to the thread that owns the current foreground window
  #    (threads attached to the foreground queue are allowed to move focus),
  #    then SetForegroundWindow on the consent window;
  #  - a short TOPMOST->NOTOPMOST toggle as the visual fallback in case the
  #    focus switch is still denied, without leaving the window topmost.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RainseeHelloWin32 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@ | Out-Null
  $script:consentClass = 'Credential Dialog Xaml Host'
  $script:baseline = @{}
  $scanBaseline = [RainseeHelloWin32+EnumProc]{
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 256
    [RainseeHelloWin32]::GetClassName($h, $sb, 256) | Out-Null
    if ($sb.ToString() -eq $script:consentClass) {
      $script:baseline[$h.ToInt64()] = $true
    }
    return $true
  }
  [RainseeHelloWin32]::EnumWindows($scanBaseline, [IntPtr]::Zero) | Out-Null
  [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
  $reason = if ($env:RAINSEE_HELLO_REASON) { $env:RAINSEE_HELLO_REASON } else { 'Verify your identity' }
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($reason)
  $script:consent = [IntPtr]::Zero
  for ($i = 0; $i -lt 100 -and $script:consent -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 100
    $find = [RainseeHelloWin32+EnumProc]{
      param($h, $l)
      if ($script:consent -eq [IntPtr]::Zero -and [RainseeHelloWin32]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [RainseeHelloWin32]::GetClassName($h, $sb, 256) | Out-Null
        if ($sb.ToString() -eq $script:consentClass -and -not $script:baseline.ContainsKey($h.ToInt64())) {
          $script:consent = $h
          return $false
        }
      }
      return $true
    }
    [RainseeHelloWin32]::EnumWindows($find, [IntPtr]::Zero) | Out-Null
  }
  if ($script:consent -ne [IntPtr]::Zero) {
    [RainseeHelloWin32]::ShowWindow($script:consent, 5) | Out-Null
    $fg = [RainseeHelloWin32]::GetForegroundWindow()
    $tmpPid = [uint32]0
    $fgThread = [RainseeHelloWin32]::GetWindowThreadProcessId($fg, [ref]$tmpPid)
    $myThread = [RainseeHelloWin32]::GetCurrentThreadId()
    if ($fgThread -ne 0 -and $fgThread -ne $myThread) {
      [RainseeHelloWin32]::AttachThreadInput($myThread, $fgThread, $true) | Out-Null
      [RainseeHelloWin32]::SetForegroundWindow($script:consent) | Out-Null
      [RainseeHelloWin32]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
    } else {
      [RainseeHelloWin32]::SetForegroundWindow($script:consent) | Out-Null
    }
    # Activation is applied asynchronously by the broker's UI thread; give it a
    # moment to take real input focus before falling back to a z-order raise.
    $focused = $false
    for ($j = 0; $j -lt 20; $j++) {
      Start-Sleep -Milliseconds 100
      if ([RainseeHelloWin32]::GetForegroundWindow() -eq $script:consent) {
        $focused = $true
        break
      }
    }
    # Fallback: raise above the browser without touching focus (SWP_NOACTIVATE).
    if (-not $focused) {
      [RainseeHelloWin32]::SetWindowPos($script:consent, [IntPtr](-1), 0, 0, 0, 0, 0x13) | Out-Null
      Start-Sleep -Milliseconds 150
      [RainseeHelloWin32]::SetWindowPos($script:consent, [IntPtr](-2), 0, 0, 0, 0, 0x13) | Out-Null
    }
  }
  $r = AwaitOp $op ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  Write-Output $r.Value__
} catch {
  Write-Output ('ERR:' + ($_.Exception.Message -replace "[\r\n]+", ' '))
}
