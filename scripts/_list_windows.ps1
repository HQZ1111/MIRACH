# _list_windows.ps1 - enumerate top-level windows of the mirach process (title / visible / rect)
param([string]$ProcessName = "mirach")
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@
$procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Output "no $ProcessName process"; exit 0 }
$owningPids = $procs | ForEach-Object { [uint32]$_.Id }
Write-Output ("mirach pids: " + ($owningPids -join ", "))
$rows = @()
$cb = [W.U+EnumWindowsProc] {
  param($h, $l)
  $owningPid = 0
  [void][W.U]::GetWindowThreadProcessId($h, [ref]$owningPid)
  if ($owningPids -contains $owningPid) {
    $title = New-Object System.Text.StringBuilder 256
    [void][W.U]::GetWindowText($h, $title, 256)
    $cls = New-Object System.Text.StringBuilder 256
    [void][W.U]::GetClassName($h, $cls, 256)
    $r = New-Object W.U+RECT
    [void][W.U]::GetWindowRect($h, [ref]$r)
    $script:rows += [pscustomobject]@{
      hwnd    = $h.ToInt64()
      pid     = $owningPid
      visible = [W.U]::IsWindowVisible($h)
      title   = $title.ToString()
      class   = $cls.ToString()
      rect    = "$($r.Left),$($r.Top) $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
    }
  }
  return $true
}
[void][W.U]::EnumWindows($cb, [IntPtr]::Zero)
$rows | Format-Table -AutoSize | Out-String -Width 200
