# Dump ALL elements (including unnamed) in a screen region, for finding clickable session rows.
param(
  [int]$X = 1400, [int]$Y = 980, [int]$W = 300, [int]$H = 400
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process my-hermes-rs | Select-Object -First 1
$rootAll = [System.Windows.Automation.AutomationElement]::RootElement
$condPid = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$wins = $rootAll.FindAll([System.Windows.Automation.TreeScope]::Children, $condPid)
$root = $null
for ($i = 0; $i -lt $wins.Count; $i++) { if ($wins.Item($i).Current.Name -like "*Hermes*") { $root = $wins.Item($i) } }
if ($null -eq $root) { Write-Output "NO_WINDOW"; exit 1 }

function Walk($el, $depth) {
  if ($depth -gt 18) { return }
  $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $kids.Count; $i++) {
    $k = $kids.Item($i)
    $r = $k.Current.BoundingRectangle
    # only elements intersecting the region
    if ($r.X -ge ($X - 20) -and $r.X -le ($X + $W) -and $r.Y -ge ($Y - 20) -and $r.Y -le ($Y + $H)) {
      $ct = $k.Current.ControlType.ProgrammaticName
      $n = $k.Current.Name
      $supportsInvoke = $null -ne $k.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -or $true
      try { $supportsInvoke = $k.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$null) } catch {}
      Write-Output ("{0}{1} name='{2}' rect=({3},{4},{5},{6}) invoke={7}" -f ("  " * [Math]::Min($depth, 6)), $ct, $n, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height, $supportsInvoke)
    }
    Walk $k ($depth + 1)
  }
}
Walk $root 0
