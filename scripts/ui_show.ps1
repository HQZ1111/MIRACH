# Restore/show all top-level windows of the app process (ShowWindow + SetForegroundWindow).
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Show {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
$pid_ = (Get-Process my-hermes-rs | Select-Object -First 1).Id
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $pid_)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Output ("WINDOW_COUNT=" + $wins.Count)
for ($i = 0; $i -lt $wins.Count; $i++) {
  $w = $wins.Item($i)
  $hwnd = [IntPtr]$w.Current.NativeWindowHandle
  $sb = New-Object System.Text.StringBuilder 256
  [Win32Show]::GetWindowText($hwnd, $sb, 256) | Out-Null
  Write-Output ("WIN[{0}] hwnd={1} title='{2}' visible={3}" -f $i, $hwnd, $sb.ToString(), [Win32Show]::IsWindowVisible($hwnd))
  [Win32Show]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
  [Win32Show]::SetForegroundWindow($hwnd) | Out-Null
}
Start-Sleep -Milliseconds 800
Write-Output "RESTORED"
