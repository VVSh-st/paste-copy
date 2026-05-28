@echo off
cd /d "%~dp0"

:: Проверяем, не запущен ли уже сервер на 8080
netstat -ano | findstr ":8080" >nul 2>&1
if %errorlevel%==0 (
    start "" "http://localhost:8080"
    exit /b
)

:: Запускаем Python-сервер в фоне
start "" /b python -m http.server 8080

:: Даём серверу секунду подняться
timeout /t 1 /nobreak >nul

:: Открываем браузер
start "" "http://localhost:8080"
