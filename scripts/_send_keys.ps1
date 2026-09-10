# _send_keys.ps1 - focus a process main window and send keystrokes (UI driving without CDP)
param(
  [string]$ProcessName = "mirach",
  [Parameter(Mandatory = $true)][string]$Keys,
  [int]$DelayMs = 700
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
'@
$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "no window for process $ProcessName" }
[W.U]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds $DelayMs
[System.Windows.Forms.SendKeys]::SendWait($Keys)
"sent: $Keys"
