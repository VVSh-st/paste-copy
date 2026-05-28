@echo off
setlocal enableextensions

cd /d "%~dp0"

set "PORT=8787"

:: Ищем PID процесса, который слушает порт
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R ":%PORT%\s"') do (
  set "PID=%%p"
  goto :kill
)

echo Server on port %PORT% not found.
exit /b 0

:kill
echo Stopping PID %PID% on port %PORT%...
taskkill /PID %PID% /F >nul 2>&1

exit /b 0
