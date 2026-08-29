# Click at absolute SCREEN coordinates (window must be foreground first).
param(
  [int]$X = 890,
  [int]$Y = 900
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32ClickXY2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $p.MainWindowHandle
[Win32ClickXY2]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
# bring to foreground with retries until it actually is
for ($i = 0; $i -lt 10; $i++) {
  [Win32ClickXY2]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([Win32ClickXY2]::GetForegroundWindow() -eq $hwnd) { break }
}
if ([Win32ClickXY2]::GetForegroundWindow() -ne $hwnd) { Write-Output "NOT_FOREGROUND"; exit 2 }
Start-Sleep -Milliseconds 200
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($X, $Y)
Start-Sleep -Milliseconds 200
[Win32ClickXY2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[Win32ClickXY2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 400
Write-Output ("CLICKED " + $X + "," + $Y + " FG=OK")
