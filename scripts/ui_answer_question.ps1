# Answer the engine's question card: type into 补充说明 then click 提交回答.
param(
  [string]$Answer = "继续"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32UiaAnswer {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

$sBuChong = [string][char]0x8865 + [char]0x5145 + [char]0x8BF4 + [char]0x660E # 补充说明
$sTiJiao = [string][char]0x63D0 + [char]0x4EA4 + [char]0x56DE + [char]0x7B54 # 提交回答

$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $p.MainWindowHandle
[Win32UiaAnswer]::ShowWindow($hwnd, 9) | Out-Null
for ($i = 0; $i -lt 10; $i++) {
  [Win32UiaAnswer]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 300
  if ([Win32UiaAnswer]::GetForegroundWindow() -eq $hwnd) { break }
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

# 1) type into 补充说明
$edit = Get-CtrlRec $root "Edit" $sBuChong
if ($null -eq $edit) { Write-Output "NO_SUPPLEMENT_FIELD"; exit 2 }
$edit.SetFocus()
[Win32UiaAnswer]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300
Set-Clipboard -Value $Answer
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 400

# 2) click 提交回答
$btn = Get-CtrlRec $root "Button" $sTiJiao
if ($null -eq $btn) { Write-Output "NO_SUBMIT_BTN"; exit 3 }
try {
  $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ip.Invoke()
  Write-Output "SUBMIT_INVOKED"
} catch {
  Write-Output "NO_INVOKE"
}
Start-Sleep -Milliseconds 300
Write-Output "DONE"
