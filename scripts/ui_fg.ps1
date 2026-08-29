# Report the app window screen rect + the current foreground window.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$p = Get-Process my-hermes-rs | Select-Object -First 1
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
for ($i = 0; $i -lt $wins.Count; $i++) {
  $w = $wins.Item($i)
  $r = $w.Current.BoundingRectangle
  Write-Output ("WIN[{0}] hwnd={1} name='{2}' rect=({3},{4},{5},{6})" -f $i, $w.Current.NativeWindowHandle, $w.Current.Name, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
}
Write-Output ("FOREGROUND=" + [Win32Fg]::GetForegroundWindow())
Write-Output ("APP_HWND=" + $p.MainWindowHandle)
