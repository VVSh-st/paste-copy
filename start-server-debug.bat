@echo off
cd /d "%~dp0"

netstat -ano | findstr ":8765" >nul 2>&1
if %errorlevel%==0 (
    start "" "http://localhost:8765"
    exit /b
)

set "PYEXE=%~dp0python\python.exe"
if exist "%PYEXE%" (
    echo Starting server on port 8765...
    "%PYEXE%" -m http.server 8765
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        echo Starting server on port 8765...
        python -m http.server 8765
    ) else (
        echo Python not found.
        pause
        exit /b 1
    )
)
