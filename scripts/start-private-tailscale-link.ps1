$ErrorActionPreference = "Stop"

$Port = $env:PRIVATE_LAPTOP_CLOUD_PORT
if (-not $Port) {
  $Port = "8787"
}

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  throw "Tailscale CLI was not found. Install Tailscale and sign in first."
}

tailscale serve --bg $Port
tailscale serve status
