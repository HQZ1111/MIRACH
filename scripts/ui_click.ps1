# Click the first button whose name contains the given text (CJK via code points).
param(
  [string]$Text = ""
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32UiaClick {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) {
  if ($wins.Item($i).Current.Name -like "*Hermes*") { $root = $wins.Item($i) }
}
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

function Get-CtrlRec($el, [string]$typeName, [string]$nameLike) {
  $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.ControlType.ProgrammaticName -like "*$typeName*" -and ($nameLike -eq "" -or $e.Current.Name -like "*$nameLike*")) { return $e }
    $found = Get-CtrlRec $e $typeName $nameLike
    if ($null -ne $found) { return $found }
  }
  return $null
}

$btn = Get-CtrlRec $root "Button" $Text
if ($null -eq $btn) { Write-Output ("NOT_FOUND:" + $Text); exit 2 }
$r = $btn.Current.BoundingRectangle
Write-Output ("FOUND rect=({0},{1},{2},{3})" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
try {
  $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ip.Invoke()
  Write-Output "INVOKED"
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [Win32UiaClick]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseClick {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
  [MouseClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [MouseClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output "MOUSE_CLICKED"
}
Start-Sleep -Milliseconds 600
Write-Output "DONE"
