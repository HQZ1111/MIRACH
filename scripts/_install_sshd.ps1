# _install_sshd.ps1 - install and configure Windows OpenSSH Server, loopback-only (ASCII)
$ErrorActionPreference = "Stop"
try {
  $r = Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  Write-Output ("capability: " + $r.Name + " state=" + $r.State + " restart=" + $r.RestartNeeded)
} catch {
  Write-Output ("capability install FAILED: " + $_.Exception.Message)
  exit 1
}
try {
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd
  Write-Output ("sshd: " + (Get-Service sshd).Status)
} catch {
  Write-Output ("sshd start FAILED: " + $_.Exception.Message)
  exit 1
}
