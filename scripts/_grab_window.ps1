# _grab_window.ps1 - capture a process main window to PNG (screen-copy, no cache)
param(
  [string]$ProcessName = "mirach",
  [string]$Out = "$env:TEMP\mirach-window.png",
  [switch]$Focus
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw "no window for process $ProcessName" }
$h = $p.MainWindowHandle
if ($Focus) {
  [W.U]::ShowWindow($h, 9) | Out-Null
  [W.U]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 800
}
$r = New-Object W.U+RECT
[W.U]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hgt)))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"$Out  ${w}x${hgt} at ($($r.Left),$($r.Top))"
