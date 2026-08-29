# Click the first button named 关闭 (settings overlay header close), then send a test message.
param(
  [string]$TextB64 = ""
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32UiaClose {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$sGuanBi = [string][char]0x5173 + [char]0x95ED # 关闭

$p = Get-Process my-hermes-rs | Select-Object -First 1
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

# close settings: the first 关闭 button (settings header) that is enabled
$closeBtn = Get-CtrlRec $root "Button" $sGuanBi
if ($null -ne $closeBtn) {
  try {
    $ip = $closeBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $ip.Invoke()
    Write-Output "CLOSE_CLICKED"
  } catch {
    $r = $closeBtn.Current.BoundingRectangle
    [Win32UiaClose]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseClose {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
    [MouseClose]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [MouseClose]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Write-Output "CLOSE_MOUSE"
  }
} else {
  Write-Output "NO_CLOSE_BTN"
}
Start-Sleep -Milliseconds 800

# send a test message if TextB64 provided
if ($TextB64 -ne "") {
  $Text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextB64))
  function Get-AllEdits($el, [System.Collections.ArrayList]$acc) {
    $all = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $all.Count; $i++) {
      $e = $all.Item($i)
      if ($e.Current.ControlType.ProgrammaticName -like "*Edit*") { [void]$acc.Add($e) }
      Get-AllEdits $e $acc
    }
  }
  $best = $null
  for ($t = 0; $t -lt 20 -and $null -eq $best; $t++) {
    $acc = New-Object System.Collections.ArrayList
    Get-AllEdits $root $acc
    foreach ($e in $acc) {
      $r = $e.Current.BoundingRectangle
      if ($r.Width -gt 100 -and $r.Height -gt 20 -and $r.X -gt 0) {
        if ($null -eq $best -or $r.Y -gt $best.Current.BoundingRectangle.Y) { $best = $e }
      }
    }
    if ($null -eq $best) { Start-Sleep -Milliseconds 800 }
  }
  if ($null -ne $best) {
    $best.SetFocus()
    [Win32UiaClose]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
    Set-Clipboard -Value $Text
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "SENT"
  } else {
    Write-Output "NO_COMPOSER"
  }
}
Write-Output "DONE"
