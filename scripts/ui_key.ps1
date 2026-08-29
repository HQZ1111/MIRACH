# Send keyboard keys to the app (must be foreground).
param(
  [string]$Keys = "{ENTER}"
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32Key {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $p.MainWindowHandle
[Win32Key]::ShowWindow($hwnd, 9) | Out-Null
for ($i = 0; $i -lt 10; $i++) {
  [Win32Key]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([Win32Key]::GetForegroundWindow() -eq $hwnd) { break }
}
if ([Win32Key]::GetForegroundWindow() -ne $hwnd) { Write-Output "NOT_FOREGROUND"; exit 2 }
# focus the composer textarea first so key events reach the page
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) { if ($wins.Item($i).Current.Name -like "*Hermes*") { $root = $wins.Item($i) } }
function Get-AllEdits($el, [System.Collections.ArrayList]$acc) {
  $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.ControlType.ProgrammaticName -like "*Edit*") { [void]$acc.Add($e) }
    Get-AllEdits $e $acc
  }
}
if ($null -ne $root) {
  $acc = New-Object System.Collections.ArrayList
  Get-AllEdits $root $acc
  $best = $null
  foreach ($e in $acc) {
    $r = $e.Current.BoundingRectangle
    if ($r.Width -gt 100 -and $r.Height -gt 20 -and $r.X -gt 100) {
      if ($null -eq $best -or $r.Y -gt $best.Current.BoundingRectangle.Y) { $best = $e }
    }
  }
  if ($null -ne $best) { $best.SetFocus() }
  Start-Sleep -Milliseconds 300
  # SetFocus AFTER foreground (matching ui_send_test: focus then foreground then keys)
  [Win32Key]::SetForegroundWindow($hwnd) | Out-Null
}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds 400
Write-Output ("KEYS_SENT " + $Keys)
