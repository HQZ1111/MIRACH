# _finish_sshd_setup2.ps1 - IPv6 loopback + known_hosts for 127.0.0.1 + smoke test (ASCII)
$ErrorActionPreference = "Continue"
$cfg = "$env:ProgramData\ssh\sshd_config"
$lines = Get-Content $cfg
if (-not ($lines | Where-Object { $_ -match '^\s*ListenAddress\s+::1\s*$' })) {
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    $out.Add($line)
    if ($line -match '^\s*ListenAddress\s+127\.0\.0\.1\s*$') { $out.Add('ListenAddress ::1') }
  }
  Set-Content -Path $cfg -Value $out -Encoding ASCII
  Write-Output "sshd_config: ListenAddress ::1 added"
} else {
  Write-Output "sshd_config: ::1 already present"
}
Restart-Service sshd
Start-Sleep -Seconds 3

$known = Join-Path $env:USERPROFILE ".ssh\known_hosts"
foreach ($h in @('127.0.0.1', '::1')) {
  $scan = & ssh-keyscan -H $h 2>&1 | Where-Object { $_ -match $h -or $_ -match '\S+\s+(ssh-|ecdsa-)' }
  $scan = $scan | Where-Object { $_ -notmatch '^\s*#' }
  if ($scan) {
    $scan | Add-Content $known
    Write-Output ("known_hosts: pinned " + $h)
  }
}

Write-Output ("sshd: " + (Get-Service sshd).Status)
foreach ($h in @('localhost', '127.0.0.1')) {
  $out = & ssh -T -o BatchMode=yes -o ConnectTimeout=8 $h "D:\node.exe --version" 2>&1
  Write-Output ("ssh[$h] node --version => " + ($out -join " | "))
}
