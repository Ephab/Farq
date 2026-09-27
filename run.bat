@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  exit /b 1
)
".venv\Scripts\python.exe" scripts\run_windows.py
exit /b %errorlevel%
