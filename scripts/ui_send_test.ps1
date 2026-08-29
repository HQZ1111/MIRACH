# Send a test message through the Hermes Desktop composer via UIAutomation.
# React controlled textarea ignores UIA ValuePattern.SetValue -> use clipboard + Ctrl+V
# (real paste event, works with CJK). -TextB64: UTF-8 base64 of the message.
param(
  [string]$TextB64 = "",
  [string]$FallbackText = "Hi! Introduce yourself in one sentence. Do not use any tools."
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32Uia4 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

if ($TextB64 -ne "") {
  $Text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextB64))
} else {
  $Text = $FallbackText
}

$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
# pick the main webview window (titled 'Mirach Dashboard'), not the empty child webview
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) {
  $w = $wins.Item($i)
  if ($w.Current.Name -like "*Hermes*") { $root = $w }
}
if ($null -eq $root) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle) }
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

function Get-AllEdits($el, [System.Collections.ArrayList]$acc) {
  $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    if ($e.Current.ControlType.ProgrammaticName -like "*Edit*") { [void]$acc.Add($e) }
    Get-AllEdits $e $acc
  }
}

$best = $null
for ($t = 0; $t -lt 30 -and $null -eq $best; $t++) {
  $acc = New-Object System.Collections.ArrayList
  Get-AllEdits $root $acc
  foreach ($e in $acc) {
    $r = $e.Current.BoundingRectangle
    if ($r.Width -gt 100 -and $r.Height -gt 20) {
      if ($null -eq $best -or $r.Y -gt $best.Current.BoundingRectangle.Y) { $best = $e }
    }
  }
  if ($null -eq $best) { Start-Sleep -Milliseconds 800 }
}
if ($null -eq $best) { Write-Output "NO_COMPOSER"; exit 2 }
Write-Output ("COMPOSER_FOUND name='{0}'" -f $best.Current.Name)
$best.SetFocus()
[Win32Uia4]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 300

Set-Clipboard -Value $Text
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 400

$vp = $best.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
Write-Output ("AFTER_PASTE len=" + $vp.Current.Value.Length)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 300
Write-Output "DONE"
