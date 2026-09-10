# _kill_dev_stack.ps1 - stop mirach + vite/tauri/tsx dev processes and free port 1420
$killed = @()
Get-Process mirach -ErrorAction SilentlyContinue | ForEach-Object { $killed += ("mirach:" + $_.Id); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
$nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
foreach ($p in $nodes) {
  $cmd = $p.CommandLine
  if ($cmd -and ($cmd -like '*vite*' -or $cmd -like '*tauri*' -or $cmd -like '*agent-sidecar*' -or $cmd -like '*tsx*')) {
    & taskkill /PID $p.ProcessId /F /T 2>&1 | Out-Null
    $killed += ("node:" + $p.ProcessId)
  }
}
Start-Sleep -Seconds 3
$listeners = (netstat -ano | Select-String ':1420')
Write-Output ("killed: " + ($killed -join ", "))
Write-Output ("1420 listeners now: " + ($listeners | Measure-Object).Count)
if (($listeners | Measure-Object).Count -gt 0) { $listeners | ForEach-Object { "  " + $_.Line.Trim() } }
