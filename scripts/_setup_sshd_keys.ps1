# _setup_sshd_keys.ps1 - loopback-only sshd + key auth for the current admin user (ASCII)
$ErrorActionPreference = "Stop"
$cfg = "$env:ProgramData\ssh\sshd_config"

# 1) bind loopback only (no network exposure) + keep password auth off for tests
$lines = Get-Content $cfg
if (-not ($lines | Where-Object { $_ -match '^\s*ListenAddress\s+127\.0\.0\.1' })) {
  Add-Content $cfg "`n# mirach test: loopback only`nListenAddress 127.0.0.1`nPubkeyAuthentication yes`n"
  Write-Output "sshd_config: ListenAddress 127.0.0.1 added"
} else {
  Write-Output "sshd_config: loopback already configured"
}

# 2) key pair for the current user
$sshDir = Join-Path $env:USERPROFILE ".ssh"
New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
$key = Join-Path $sshDir "id_ed25519"
if (-not (Test-Path $key)) {
  & ssh-keygen -t ed25519 -N '""' -f $key -q
  Write-Output "generated $key"
} else {
  Write-Output "existing key $key"
}

# 3) admin user => administrators_authorized_keys with restricted ACLs
$admKeys = "$env:ProgramData\ssh\administrators_authorized_keys"
$pub = (Get-Content "$key.pub" -Raw).Trim()
if (-not (Test-Path $admKeys) -or -not (Select-String -Path $admKeys -SimpleMatch $pub -Quiet)) {
  Add-Content $admKeys $pub
  Write-Output "authorized key added"
} else {
  Write-Output "authorized key already present"
}
& icacls $admKeys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
Write-Output "acl applied"

# 4) trust the host key locally so BatchMode clients do not prompt
$known = Join-Path $sshDir "known_hosts"
if (-not (Test-Path $known) -or -not (Select-String -Path $known -SimpleMatch "localhost" -Quiet)) {
  & ssh-keyscan -H localhost 2>$null | Add-Content $known
  Write-Output "known_hosts: localhost pinned"
} else {
  Write-Output "known_hosts: localhost already pinned"
}

# 5) restart sshd and smoke test
Restart-Service sshd
Start-Sleep -Seconds 3
Write-Output ("sshd: " + (Get-Service sshd).Status)
$out = & ssh -T -o BatchMode=yes -o ConnectTimeout=8 localhost "D:\node.exe --version" 2>&1
Write-Output ("ssh node --version => " + ($out -join " "))
