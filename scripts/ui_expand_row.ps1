# Focus a tool row button and press Enter to expand it.
param(
  [string]$Text = "Write {"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32UiaExpand {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $p.MainWindowHandle
[Win32UiaExpand]::ShowWindow($hwnd, 9) | Out-Null
for ($i = 0; $i -lt 10; $i++) {
  [Win32UiaExpand]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([Win32UiaExpand]::GetForegroundWindow() -eq $hwnd) { break }
}
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) { if ($wins.Item($i).Current.Name -like "*Hermes*") { $root = $wins.Item($i) } }
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
if ($null -eq $btn) { Write-Output "NOT_FOUND"; exit 2 }
$btn.SetFocus()
[Win32UiaExpand]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 400
Write-Output "ENTER_SENT"
