# Click a button by name with optional window-relative X-range filter (UIA InvokePattern).
param(
  [string]$Text = "",
  [int]$XFrom = -1,
  [int]$XTo = -1
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process my-hermes-rs | Select-Object -First 1
if (-not $p) { Write-Output "NO_PROCESS"; exit 1 }
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) { if ($wins.Item($i).Current.Name -like "*Hermes*") { $root = $wins.Item($i) } }
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

function Get-CtrlRec($el, [string]$typeName, [string]$nameLike, [int]$xf, [int]$xt) {
  $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $e = $all.Item($i)
    $r = $e.Current.BoundingRectangle
    $inRange = $xf -lt 0 -or ($r.X -ge $xf -and $r.X -le $xt)
    if ($e.Current.ControlType.ProgrammaticName -like "*$typeName*" -and ($nameLike -eq "" -or $e.Current.Name -like "*$nameLike*") -and $inRange) { return $e }
    $found = Get-CtrlRec $e $typeName $nameLike $xf $xt
    if ($null -ne $found) { return $found }
  }
  return $null
}

$btn = Get-CtrlRec $root "Button" $Text $XFrom $XTo
if ($null -eq $btn) { Write-Output "NOT_FOUND"; exit 2 }
$r = $btn.Current.BoundingRectangle
Write-Output ("FOUND rect=({0},{1},{2},{3})" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
try {
  $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $ip.Invoke()
  Write-Output "INVOKED"
} catch {
  Write-Output "NO_INVOKE_PATTERN"
}
Start-Sleep -Milliseconds 400
Write-Output "DONE"
