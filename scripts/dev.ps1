$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
if (-not (Test-Path .venv)) { throw "Run scripts/setup.ps1 first." }

Get-Content .env -ErrorAction Stop | ForEach-Object {
  if ($_ -match '^([^#][^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') }
}
$env:HERMES_ENABLE_PROJECT_PLUGINS = "1"
$env:HERMES_HOME = Join-Path $repo ".hermes-runtime"
$env:API_SERVER_ENABLED = "true"
$env:API_SERVER_HOST = "127.0.0.1"
$env:API_SERVER_PORT = "8642"
$env:FARQ_API_INTERNAL_URL = "http://127.0.0.1:8000"
$env:HERMES_API_KEY = if ($env:HERMES_API_KEY) { $env:HERMES_API_KEY } else { "" }
if ($env:HERMES_API_KEY.Length -lt 16) { throw "HERMES_API_KEY is missing or too short. Run scripts/setup.ps1." }
$env:API_SERVER_KEY = $env:HERMES_API_KEY
$env:FARQ_INTERNAL_TOKEN = if ($env:FARQ_INTERNAL_TOKEN) { $env:FARQ_INTERNAL_TOKEN } else { "farq-internal-dev" }

# Retain the exact processes started by this invocation. Never kill by image
# name: other projects (and editors) may also be running Python or Node.
$services = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
try {
  $services.Add((Start-Process -FilePath ".venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "services/api", "--reload", "--port", "8000" -WorkingDirectory $repo -WindowStyle Hidden -PassThru))
  $services.Add((Start-Process -FilePath "hermes" -ArgumentList "gateway" -WorkingDirectory $repo -WindowStyle Hidden -PassThru))
  Write-Host "FastAPI and Hermes started in the background. Ctrl+C stops this session's services. Starting Vite at http://127.0.0.1:5173"
  npm run dev
}
finally {
  Write-Host "Stopping Farq background services..."
  foreach ($service in $services) {
    try {
      if (-not $service.HasExited) {
        # /T includes the Uvicorn reloader worker and Hermes launcher children.
        & taskkill.exe /PID $service.Id /T /F 2>&1 | Out-Null
      }
    }
    catch { Write-Warning "Could not stop Farq process $($service.Id): $_" }
    finally { $service.Dispose() }
  }
}
