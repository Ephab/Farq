$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$lines = [System.Collections.Generic.List[string]](Get-Content .env)
$keyLine = $lines.FindIndex([Predicate[string]]{ param($line) $line -match '^HERMES_API_KEY=' })
$currentKey = if ($keyLine -ge 0) { ($lines[$keyLine] -split '=', 2)[1].Trim() } else { "" }
if ($currentKey.Length -lt 32) {
  $keyBytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($keyBytes)
  $generator.Dispose()
  $generatedKey = -join ($keyBytes | ForEach-Object { $_.ToString("x2") })
  if ($keyLine -ge 0) { $lines[$keyLine] = "HERMES_API_KEY=$generatedKey" } else { $lines.Add("HERMES_API_KEY=$generatedKey") }
  [IO.File]::WriteAllLines((Join-Path $repo ".env"), $lines)
}
if (-not (Test-Path .venv)) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -r services\api\requirements.txt
npm install
New-Item -ItemType Directory -Force -Path .hermes-runtime | Out-Null
Copy-Item services\hermes\config.yaml .hermes-runtime\config.yaml -Force
Copy-Item services\hermes\SOUL.md .hermes-runtime\SOUL.md -Force
New-Item -ItemType Directory -Force -Path .hermes-runtime\plugins\farq | Out-Null
Copy-Item .hermes\plugins\farq\* .hermes-runtime\plugins\farq -Recurse -Force
foreach ($skill in Get-ChildItem .hermes\skills -Directory) {
  New-Item -ItemType Directory -Force -Path ".hermes-runtime\skills\$($skill.Name)" | Out-Null
  Copy-Item "$($skill.FullName)\*" ".hermes-runtime\skills\$($skill.Name)" -Recurse -Force
}
Write-Host "Setup complete. Add GEMINI_API_KEY to .env, then run scripts/dev.ps1."
