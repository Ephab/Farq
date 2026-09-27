$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCommand) {
    $uvPath = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
    if (-not (Test-Path -LiteralPath $uvPath)) {
        Write-Host 'Installing uv from astral.sh...'
        Invoke-RestMethod https://astral.sh/uv/0.12.18/install.ps1 | Invoke-Expression
    }
    if (-not (Test-Path -LiteralPath $uvPath)) { throw 'uv installation failed.' }
} else {
    $uvPath = $uvCommand.Source
}
& $uvPath python install 3.12
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
& $uvPath run --no-project --python 3.12 (Join-Path $PSScriptRoot 'setup_local.py') --uv $uvPath
if ($LASTEXITCODE -ne 0) { throw 'Farq setup failed. Correct the error above and rerun setup.bat.' }
