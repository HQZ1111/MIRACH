# _fix_sshd_config.ps1 - move test directives out of the Match block (ASCII)
$ErrorActionPreference = "Stop"
$cfg = "$env:ProgramData\ssh\sshd_config"
Copy-Item $cfg "$cfg.bak" -Force
$lines = Get-Content $cfg
# drop previously appended test block
$filtered = $lines | Where-Object { $_ -notmatch 'mirach test: loopback only' -and $_ -notmatch '^\s*ListenAddress\s+127\.0\.0\.1\s*$' -and $_ -notmatch '^\s*PubkeyAuthentication\s+yes\s*$' }
# insert before the first Match block (global scope)
$out = New-Object System.Collections.Generic.List[string]
$inserted = $false
foreach ($line in $filtered) {
  if (-not $inserted -and $line -match '^\s*Match\s') {
    $out.Add('# mirach test: loopback only')
    $out.Add('ListenAddress 127.0.0.1')
    $out.Add('PubkeyAuthentication yes')
    $out.Add('')
    $inserted = $true
  }
  $out.Add($line)
}
if (-not $inserted) {
  $out.Insert(0, 'ListenAddress 127.0.0.1')
  $out.Insert(0, '# mirach test: loopback only')
}
Set-Content -Path $cfg -Value $out -Encoding ASCII
Write-Output "sshd_config rewritten (backup: $cfg.bak)"

$t = & "C:\Windows\System32\OpenSSH\sshd.exe" -t 2>&1
Write-Output ("config test: " + ($t -join " | "))
Start-Service sshd
Start-Sleep -Seconds 2
Write-Output ("sshd: " + (Get-Service sshd).Status)
