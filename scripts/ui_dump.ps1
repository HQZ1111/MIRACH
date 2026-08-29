Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process my-hermes-rs | Select-Object -First 1
Write-Output ("WIN_PID=" + $p.Id + " HWND=" + $p.MainWindowHandle + " TITLE=" + $p.MainWindowTitle)
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
function Walk($el, $depth) {
  if ($depth -gt 14) { return }
  $ct = $el.Current.ControlType.ProgrammaticName
  $name = $el.Current.Name
  $aid = $el.Current.AutomationId
  $r = $el.Current.BoundingRectangle
  if ($name -or $aid) {
    Write-Output ("{0}{1} name='{2}' aid='{3}' rect=({4},{5},{6},{7})" -f (" " * ($depth * 2)), $ct, $name, $aid, $r.X, $r.Y, $r.Width, $r.Height)
  }
  $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $children.Count; $i++) {
    Walk $children.Item($i) ($depth + 1)
  }
}
Walk $root 0
