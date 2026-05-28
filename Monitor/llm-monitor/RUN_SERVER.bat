@echo off
setlocal enableextensions

cd /d "%~dp0"

set "PORT=8787"
set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%"

:: Проверяем, не запущен ли уже сервер на нужном порту
netstat -ano | findstr /R ":%PORT%\s" >nul 2>&1
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

:: Запускаем Node-сервер в фоне (без окна через VBS-обёртку)
start "" /b cmd /c "set PORT=%PORT%&& set HOST=%HOST%&& npm start"

:: Даём серверу немного подняться
timeout /t 1 /nobreak >nul

:: Открываем браузер
start "" "%URL%"

endlocal
