# Dump all top-level windows of the app process, walking each recursively.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$pid_ = (Get-Process my-hermes-rs | Select-Object -First 1).Id
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $pid_)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Output ("APP_PID=" + $pid_ + " WINDOW_COUNT=" + $wins.Count)

function Walk($el, $depth) {
  if ($depth -gt 16) { return }
  $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $kids.Count; $i++) {
    $k = $kids.Item($i)
    $n = $k.Current.Name
    $ct = $k.Current.ControlType.ProgrammaticName
    $r = $k.Current.BoundingRectangle
    if ($n) {
      Write-Output ("{0}{1} name='{2}' rect=({3},{4},{5},{6})" -f ("  " * $depth), $ct, $n, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
    }
    Walk $k ($depth + 1)
  }
}

for ($i = 0; $i -lt $wins.Count; $i++) {
  $w = $wins.Item($i)
  $hwnd = $w.Current.NativeWindowHandle
  Write-Output ("--- WIN[{0}] hwnd={1} name='{2}' ---" -f $i, $hwnd, $w.Current.Name)
  Walk $w 1
}
