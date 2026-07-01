@echo off
taskkill /f /im python.exe 2>nul
taskkill /f /im pythonw.exe 2>nul
timeout /t 1 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":8080" >nul 2>&1
if %errorlevel%==0 (
    echo Server still running on port 8080
) else (
    echo Server stopped.
)
