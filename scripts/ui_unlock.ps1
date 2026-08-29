# Unlock the Hermes Desktop startup lock screen via UIAutomation (with retry).
# WebView2 quirks:
#  - FindAll(Descendants, ...) does NOT descend into the web-content pane
#    -> must walk Children recursively (like the dump script does).
#  - ControlType PropertyCondition returns 0 -> filter by ProgrammaticName in PS.
# All CJK strings built from code points (PowerShell 5.1 reads .ps1 as ANSI/GBK).
param(
  [string]$Password = "test1234"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$sMiMa = [string][char]0x5BC6 + [char]0x7801   # 密码
$sJieSuo = [string][char]0x89E3 + [char]0x9501 # 解锁

$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p -or $p.MainWindowHandle -eq 0) { Write-Output "NO_WINDOW"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

function Get-CtrlRec($el, [string]$typeName, [string]$nameLike) {
  $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    $ct = $e.Current.ControlType.ProgrammaticName
    $nm = $e.Current.Name
    if ($ct -like "*$typeName*" -and ($nameLike -eq "" -or $nm -like "*$nameLike*")) {
      return $e
    }
    $found = Get-CtrlRec $e $typeName $nameLike
    if ($null -ne $found) { return $found }
  }
  return $null
}

$field = $null
for ($t = 0; $t -lt 20 -and $null -eq $field; $t++) {
  $field = Get-CtrlRec $root "Edit" $sMiMa
  if ($null -eq $field) { Start-Sleep -Milliseconds 750 }
}
if ($null -eq $field) { Write-Output "NO_PASSWORD_FIELD"; exit 2 }
Write-Output "FIELD_FOUND"
$vp = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue($Password)
Write-Output "PW_SET"
$field.SetFocus()
Start-Sleep -Milliseconds 200

$btn = Get-CtrlRec $root "Button" $sJieSuo
if ($null -ne $btn) {
  $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ip.Invoke()
  Write-Output "UNLOCK_CLICKED"
} else {
  Write-Output "NO_UNLOCK_BTN"
}
for ($t = 0; $t -lt 15; $t++) {
  Start-Sleep -Milliseconds 800
  if ($null -eq (Get-CtrlRec $root "Edit" $sMiMa)) { Write-Output "LOCK_GONE"; exit 0 }
}
Write-Output "STILL_LOCKED"
exit 3
