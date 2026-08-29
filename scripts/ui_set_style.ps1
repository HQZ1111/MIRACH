# Switch the conversation style (default / dsh / minimal) via the Settings overlay.
# Click 设置 in the left rail, then click the style option, then close (Esc).
param(
  [string]$Style = "dsh"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32UiaStyle {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$sSheZhi = [string][char]0x8BBE + [char]0x7F6E   # 设置
$sXiTong = [string][char]0x7CFB + [char]0x7EDF   # 系统

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

function Click-Ctrl($el) {
  $r = $el.Current.BoundingRectangle
  $ip = $null
  try { $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
  if ($null -ne $ip) { $ip.Invoke() }
  else {
    $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
    Add-Type -AssemblyName System.Windows.Forms
    [Win32UiaStyle]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseStyle {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
    [MouseStyle]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
    [MouseStyle]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
  }
}

# 1) click 设置 in the left rail
$btn = Get-CtrlRec $root "Button" $sSheZhi
if ($null -eq $btn) { Write-Output "NO_SETTINGS_BTN"; exit 2 }
Click-Ctrl $btn
Write-Output "SETTINGS_CLICKED"
Start-Sleep -Milliseconds 1500

# 2) click the style option (default / dsh系统 / 简约)
$opt = Get-CtrlRec $root "Button" $Style
if ($null -eq $opt) { Write-Output ("NO_STYLE_OPT_" + $Style); exit 3 }
Click-Ctrl $opt
Write-Output ("STYLE_CLICKED_" + $Style)
Start-Sleep -Milliseconds 800

# 3) close the settings overlay with Esc
Add-Type -AssemblyName System.Windows.Forms
[Win32UiaStyle]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 800
Write-Output "DONE"
