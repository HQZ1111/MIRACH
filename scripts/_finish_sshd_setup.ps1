# _finish_sshd_setup.ps1 - known_hosts pin + restart + smoke test (ASCII)
$ErrorActionPreference = "Continue"
$sshDir = Join-Path $env:USERPROFILE ".ssh"
$known = Join-Path $sshDir "known_hosts"
$scan = & ssh-keyscan -H localhost 2>&1 | Where-Object { $_ -notmatch '^\s*#' -and $_ -match 'localhost' }
if ($scan) {
  $scan | Add-Content $known
  Write-Output ("known_hosts: pinned " + ($scan | Measure-Object).Count + " line(s)")
} else {
  Write-Output "known_hosts: ssh-keyscan returned nothing"
}
Restart-Service sshd
Start-Sleep -Seconds 3
Write-Output ("sshd: " + (Get-Service sshd).Status)
$out = & ssh -T -o BatchMode=yes -o ConnectTimeout=8 localhost "D:\node.exe --version" 2>&1
Write-Output ("ssh node --version => " + ($out -join " | "))
