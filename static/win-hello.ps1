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
  [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
  $reason = if ($env:RAINSEE_HELLO_REASON) { $env:RAINSEE_HELLO_REASON } else { 'Verify your identity' }
  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($reason)
  $r = AwaitOp $op ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  Write-Output $r.Value__
} catch {
  Write-Output ('ERR:' + ($_.Exception.Message -replace "[\r\n]+", ' '))
}
