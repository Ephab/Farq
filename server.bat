@echo off
rem Waypoint shared server: runs on its own, separate from the Waypoint app.
rem   server.bat start --domain your-name.ngrok-free.dev   (domain is remembered after the first time)
rem   server.bat start | status | stop | stop --all
rem Starting, restarting or quitting the app never touches it, and stopping it never touches the app.
setlocal
set "SERVICE=%~dp0services\collaboration"
if not exist "%SERVICE%\.venv\Scripts\python.exe" (
  echo Setting up the server environment, one time...
  pushd "%SERVICE%"
  uv sync --locked --group dev || (echo Could not set up the server environment & popd & exit /b 1)
  popd
)
if not exist "%SERVICE%\.env" (
  echo First run: creating the server's local configuration...
  pushd "%SERVICE%"
  ".venv\Scripts\python.exe" scripts\init_dev.py || (popd & exit /b 1)
  popd
)
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=status"
pushd "%SERVICE%"
".venv\Scripts\python.exe" pilot\pilot.py %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
