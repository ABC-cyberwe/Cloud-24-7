$ErrorActionPreference = "SilentlyContinue"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectDir "logs"
$OutLog = Join-Path $LogDir "cloud-output.log"
$ErrLog = Join-Path $LogDir "cloud-error.log"
$HealthUrl = "http://127.0.0.1:8787/api/health"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-CloudRunning {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

while ($true) {
  if (Test-CloudRunning) {
    Start-Sleep -Seconds 30
    continue
  }

  Add-Content -Path $OutLog -Value "$(Get-Date -Format s) Starting Cloud 24/7"

  $process = Start-Process `
    -FilePath "node.exe" `
    -ArgumentList "src/server.js" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru

  Wait-Process -Id $process.Id
  Add-Content -Path $OutLog -Value "$(Get-Date -Format s) Cloud 24/7 stopped. Restarting soon."
  Start-Sleep -Seconds 5
}
