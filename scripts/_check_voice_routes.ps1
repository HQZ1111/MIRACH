# _check_voice_routes.ps1 - probe the dsh-realtime-voice routes on the running engine (read-only)
$urls = @(
  'http://127.0.0.1:3212/dsh-realtime-voice/client.js',
  'http://127.0.0.1:3212/dsh-realtime-voice/models',
  'http://127.0.0.1:3212/dsh-realtime-voice/audio-input-worklet.js',
  'http://127.0.0.1:3212/dsh-voice-agent/models'
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 6
    Write-Output ("{0} -> HTTP {1} ({2} bytes)" -f $u, $r.StatusCode, $r.RawContentLength)
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { Write-Output ("{0} -> HTTP {1}" -f $u, [int]$resp.StatusCode) }
    else { Write-Output ("{0} -> {1}" -f $u, $_.Exception.Message) }
  }
}
