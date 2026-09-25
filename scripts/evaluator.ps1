$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo ".env"
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name)) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
    }
  }
}
$python = Join-Path $repo ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "Run scripts/setup.ps1 first." }
& $python (Join-Path $repo "scripts\evaluator_worker.py")
