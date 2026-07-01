@echo off
cd /d "%~dp0"

netstat -ano | findstr ":8080" >nul 2>&1
if %errorlevel%==0 (
    start "" "http://localhost:8080"
    exit /b
)

set "PYEXE=%~dp0python\python.exe"
if exist "%PYEXE%" (
    "%PYEXE%" -m http.server 8080
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        python -m http.server 8080
    ) else (
        echo Python not found.
        pause
        exit /b 1
    )
)
