@echo off
cd /d "%~dp0"

set PORT=8787

:: Проверяем, не запущен ли уже сервер на этом порту
netstat -ano | findstr ":%PORT%" >nul 2>&1
if %errorlevel%==0 (
    start "" "http://localhost:%PORT%"
    exit /b
)

:: Запускаем Python-сервер в фоне
start "" /b python -m http.server %PORT%

:: Даём серверу секунду подняться
timeout /t 1 /nobreak >nul

:: Открываем браузер
start "" "http://localhost:%PORT%"