# Share the running app (docker compose up) with friends.
#   Same Wi-Fi:  http://<this PC's Wi-Fi IP>:3000
#   Anywhere:    the ngrok link (NGROK_URL in .env, or a new one)
# The links are also written to share-links.txt. Close this window to stop the ngrok link.
$Host.UI.RawUI.WindowTitle = 'BITS reports - share link'
Set-Location $PSScriptRoot

$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' -and $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $ip) { $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress }

$ngrokUrl = ''
if (Test-Path .env) { $line = Get-Content .env | Where-Object { $_ -match '^\s*NGROK_URL\s*=' } | Select-Object -First 1
  if ($line) { $ngrokUrl = ($line -split '=', 2)[1].Trim().Trim('"') } }

$app = 'not-checked'
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:3000/ ; $app = "running ($($r.StatusCode))" } catch { $app = 'NOT running' }
$ngrok = if (Get-Command ngrok -ErrorAction SilentlyContinue) { 'installed' } else { 'not-installed' }
$fw = if (Get-NetFirewallRule -DisplayName 'BITS reports 3000' -ErrorAction SilentlyContinue) { 'open' } else { 'no-rule' }
$netProfile = (Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' } | Select-Object -First 1).NetworkCategory

@("WIFI_IP=$ip", "WIFI_LINK=http://${ip}:3000", "NGROK_URL=$ngrokUrl", "APP=$app", "NGROK=$ngrok", "FIREWALL=$fw", "WIFI_PROFILE=$netProfile") |
  Set-Content share-links.txt

Write-Host ''
Write-Host ' ==============================================================' -ForegroundColor Cyan
Write-Host "  App on this PC  :  $app"
Write-Host "  Same Wi-Fi link :  http://${ip}:3000" -ForegroundColor Green
if ($ngrokUrl) { Write-Host "  Internet link   :  $ngrokUrl" -ForegroundColor Green }
Write-Host ' ==============================================================' -ForegroundColor Cyan
Write-Host ''
if ($app -eq 'NOT running') { Write-Host '  Start the app first:  docker compose up' -ForegroundColor Yellow }

if ($ngrok -ne 'installed') {
  Write-Host '  ngrok is not installed, so there is no internet link yet.'
  Write-Host '  Install it:  winget install ngrok.ngrok'
  Write-Host '  Then:        ngrok config add-authtoken <token from dashboard.ngrok.com>'
  Read-Host '  Press Enter to close'
  exit
}
Write-Host '  Starting the internet link. Keep this window open while your friend uses it.'
Write-Host ''
if ($ngrokUrl) {
  ngrok http 3000 --url=$ngrokUrl
  if ($LASTEXITCODE -ne 0) {
    Add-Content share-links.txt 'NGROK_FIXED=failed'
    Write-Host '  The fixed address did not work for this ngrok account; starting a new one...' -ForegroundColor Yellow
    ngrok http 3000
  }
} else { ngrok http 3000 }
Read-Host '  Press Enter to close'
