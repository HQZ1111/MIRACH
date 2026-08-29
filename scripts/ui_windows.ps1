# Enumerate all top-level UIA windows belonging to the app process.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$pid_ = (Get-Process my-hermes-rs | Select-Object -First 1).Id
Write-Output ("APP_PID=" + $pid_)
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $pid_)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Output ("WINDOW_COUNT=" + $wins.Count)
for ($i = 0; $i -lt $wins.Count; $i++) {
  $w = $wins.Item($i)
  $r = $w.Current.BoundingRectangle
  Write-Output ("WIN[{0}] type={1} title='{2}' rect=({3},{4},{5},{6}) visible={7}" -f $i, $w.Current.ControlType.ProgrammaticName, $w.Current.Name, $r.X, $r.Y, $r.Width, $r.Height, $w.Current.IsOffscreen -eq $false)
}
