# Rainsee Browser - Windows account password verification (fallback when
# Windows Hello is unavailable / not configured / disabled by policy).
# Invoked by the main process: powershell.exe -NoProfile -ExecutionPolicy Bypass -File <this>
# Inputs (env block, Unicode-safe):
#   RAINSEE_CRED_CAPTION  dialog caption
#   RAINSEE_CRED_MESSAGE  dialog message
#   RAINSEE_CRED_HWND     decimal HWND of the browser window (dialog owner), optional
# Prints a single integer or 'ERR:<message>':
#   0 Verified   5 RetriesExhausted   6 Canceled
#
# Shows the standard "Windows Security" credential dialog limited to the
# current user, validates the typed password with LogonUser and requires the
# resulting token to belong to the CURRENT user (another account's valid
# password must not pass). Password buffers are zeroed after use.
#
# This file is intentionally pure-ASCII on disk so encoding is unambiguous for
# PowerShell 5.1 (no BOM dependency). Localized UI strings live in the TS caller.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class RainseeCredVerify {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDUI_INFO {
    public int cbSize;
    public IntPtr hwndParent;
    public string pszMessageText;
    public string pszCaptionText;
    public IntPtr hbmBanner;
  }
  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  static extern int CredUIPromptForWindowsCredentials(ref CREDUI_INFO info, int authError,
    ref uint authPackage, IntPtr inBuf, uint inBufSize, out IntPtr outBuf, out uint outBufSize,
    ref bool save, int flags);
  [DllImport("credui.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredUnPackAuthenticationBuffer(int flags, IntPtr buf, uint size,
    StringBuilder user, ref int userLen, StringBuilder domain, ref int domainLen,
    StringBuilder pass, ref int passLen);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool LogonUser(string user, string domain, StringBuilder pass,
    int logonType, int provider, out IntPtr token);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")]
  static extern void RtlZeroMemory(IntPtr dst, UIntPtr len);

  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  // The credential dialog is hosted by CredentialUIBroker.exe in a window of
  // class 'Credential Dialog Xaml Host'. Launched from a hidden background
  // process it has no foreground rights and opens BEHIND the browser, so a
  // watcher thread raises it (same approach as win-hello.ps1).
  const string DialogClass = "Credential Dialog Xaml Host";

  static List<IntPtr> DialogWindows(bool visibleOnly) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString() == DialogClass && (!visibleOnly || IsWindowVisible(h))) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static void RaiseWhenShown(List<IntPtr> baseline) {
    IntPtr dlg = IntPtr.Zero;
    for (int i = 0; i < 100 && dlg == IntPtr.Zero; i++) {
      Thread.Sleep(100);
      foreach (var h in DialogWindows(true)) {
        if (!baseline.Contains(h)) { dlg = h; break; }
      }
    }
    if (dlg == IntPtr.Zero) return;
    uint tmp;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out tmp);
    uint me = GetCurrentThreadId();
    if (fgThread != 0 && fgThread != me) {
      AttachThreadInput(me, fgThread, true);
      SetForegroundWindow(dlg);
      AttachThreadInput(me, fgThread, false);
    } else {
      SetForegroundWindow(dlg);
    }
    for (int j = 0; j < 20; j++) {
      Thread.Sleep(100);
      if (GetForegroundWindow() == dlg) return;
    }
    // Fallback: raise above the browser without touching focus (SWP_NOACTIVATE).
    SetWindowPos(dlg, new IntPtr(-1), 0, 0, 0, 0, 0x13);
    Thread.Sleep(150);
    SetWindowPos(dlg, new IntPtr(-2), 0, 0, 0, 0, 0x13);
  }

  const int CREDUIWIN_ENUMERATE_CURRENT_USER = 0x200;
  const int ERROR_CANCELLED = 1223;
  const int ERROR_LOGON_FAILURE = 1326;
  const int ERROR_ACCOUNT_RESTRICTION = 1327;
  const int ERROR_LOGON_TYPE_NOT_GRANTED = 1385;
  const int LOGON32_LOGON_INTERACTIVE = 2;
  const int LOGON32_PROVIDER_DEFAULT = 0;
  const int MAX_ATTEMPTS = 5;

  static void Wipe(StringBuilder sb) {
    for (int i = 0; i < sb.Length; i++) sb[i] = '\0';
    sb.Length = 0;
  }

  static bool IsCurrentUser(string domain, string user) {
    SecurityIdentifier me = WindowsIdentity.GetCurrent().User;
    try {
      string name = string.IsNullOrEmpty(domain) ? user : domain + "\\" + user;
      var sid = (SecurityIdentifier)new NTAccount(name).Translate(typeof(SecurityIdentifier));
      return sid.Equals(me);
    } catch {
      return false;
    }
  }

  // Returns true only when the password is correct for the current user.
  static bool Check(string domain, string user, StringBuilder pass) {
    IntPtr token;
    if (LogonUser(user, string.IsNullOrEmpty(domain) ? null : domain, pass,
        LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, out token)) {
      try {
        using (var id = new WindowsIdentity(token)) {
          return id.User.Equals(WindowsIdentity.GetCurrent().User);
        }
      } finally {
        CloseHandle(token);
      }
    }
    int err = Marshal.GetLastWin32Error();
    // Credentials are valid but this logon type is restricted (e.g. a blank
    // password account under LimitBlankPasswordUse, or interactive logon not
    // granted). The password itself was accepted, so only the identity check
    // remains.
    if (err == ERROR_ACCOUNT_RESTRICTION || err == ERROR_LOGON_TYPE_NOT_GRANTED) {
      return IsCurrentUser(domain, user);
    }
    return false;
  }

  public static int Verify(IntPtr owner, string caption, string message) {
    int authError = 0;
    for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var info = new CREDUI_INFO();
      info.cbSize = Marshal.SizeOf(typeof(CREDUI_INFO));
      info.hwndParent = owner;
      info.pszCaptionText = caption;
      info.pszMessageText = message;
      uint pkg = 0;
      IntPtr outBuf;
      uint outSize;
      bool save = false;
      var baseline = DialogWindows(false);
      var watcher = new Thread(() => { try { RaiseWhenShown(baseline); } catch { } });
      watcher.IsBackground = true;
      watcher.Start();
      int rc = CredUIPromptForWindowsCredentials(ref info, authError, ref pkg,
        IntPtr.Zero, 0, out outBuf, out outSize, ref save, CREDUIWIN_ENUMERATE_CURRENT_USER);
      if (rc == ERROR_CANCELLED) return 6;
      if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);

      var user = new StringBuilder(514);
      var domain = new StringBuilder(338);
      var pass = new StringBuilder(514);
      int userLen = user.Capacity, domainLen = domain.Capacity, passLen = pass.Capacity;
      bool ok = false;
      try {
        if (!CredUnPackAuthenticationBuffer(0, outBuf, outSize, user, ref userLen,
            domain, ref domainLen, pass, ref passLen)) {
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        string u = user.ToString();
        string d = domain.ToString();
        int slash = u.IndexOf('\\');
        if (string.IsNullOrEmpty(d) && slash >= 0) {
          d = u.Substring(0, slash);
          u = u.Substring(slash + 1);
        }
        ok = Check(d, u, pass);
      } finally {
        Wipe(pass);
        RtlZeroMemory(outBuf, (UIntPtr)outSize);
        Marshal.FreeCoTaskMem(outBuf);
      }
      if (ok) return 0;
      authError = ERROR_LOGON_FAILURE;
    }
    return 5;
  }
}
'@ | Out-Null

  $owner = [IntPtr]::Zero
  if ($env:RAINSEE_CRED_HWND) { $owner = [IntPtr][long]$env:RAINSEE_CRED_HWND }
  $caption = if ($env:RAINSEE_CRED_CAPTION) { $env:RAINSEE_CRED_CAPTION } else { 'Windows Security' }
  $message = if ($env:RAINSEE_CRED_MESSAGE) { $env:RAINSEE_CRED_MESSAGE } else { 'Enter your Windows password' }
  Write-Output ([RainseeCredVerify]::Verify($owner, $caption, $message))
} catch {
  Write-Output ('ERR:' + ($_.Exception.Message -replace "[\r\n]+", ' '))
}
