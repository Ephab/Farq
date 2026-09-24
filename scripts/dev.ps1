$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
if (-not (Test-Path .venv)) { throw "Run scripts/setup.ps1 first." }

foreach ($port in 8000, 8642) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop the previous Farq session before restarting so services load the current .env."
  }
}

Get-Content .env -ErrorAction Stop | ForEach-Object {
  if ($_ -match '^([^#][^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') }
}
# Refresh the checked-in Hermes soul, plugin and skills so edits apply on every start.
New-Item -ItemType Directory -Force -Path .hermes-runtime\plugins\farq | Out-Null
Copy-Item services\hermes\config.yaml .hermes-runtime\config.yaml -Force
Copy-Item services\hermes\SOUL.md .hermes-runtime\SOUL.md -Force
Copy-Item .hermes\plugins\farq\* .hermes-runtime\plugins\farq -Recurse -Force
foreach ($skill in Get-ChildItem .hermes\skills -Directory) {
  New-Item -ItemType Directory -Force -Path ".hermes-runtime\skills\$($skill.Name)" | Out-Null
  Copy-Item "$($skill.FullName)\*" ".hermes-runtime\skills\$($skill.Name)" -Recurse -Force
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
$logDir = Join-Path $repo "logs/dev-$PID"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
try {
  $api = Start-Process -FilePath ".venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "services/api", "--reload", "--port", "8000" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$logDir/api.stdout.log" -RedirectStandardError "$logDir/api.stderr.log" -PassThru
  $services.Add($api)
  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  while ((Get-Date) -lt $deadline -and -not $api.HasExited) {
    try {
      $response = Invoke-WebRequest "http://127.0.0.1:8000/openapi.json" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $ready) {
    throw "FastAPI failed to become ready. See $logDir/api.stderr.log. If dependencies are missing, run .venv/Scripts/python -m pip install -r services/api/requirements.txt."
  }
  # Hermes has its own Python runtime. An activated Farq venv can otherwise
  # make its Windows launcher load Python 3.13 extensions into Python 3.11.
  $pythonEnvironment = @{}
  try {
    foreach ($name in "VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME") {
      $pythonEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $services.Add((Start-Process -FilePath "hermes" -ArgumentList "gateway" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$logDir/hermes.stdout.log" -RedirectStandardError "$logDir/hermes.stderr.log" -PassThru))
  }
  finally {
    foreach ($name in $pythonEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $pythonEnvironment[$name], 'Process')
    }
  }
  Write-Host "Service logs: $logDir"
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
