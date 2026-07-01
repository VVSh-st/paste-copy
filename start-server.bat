@echo off
cd /d "%~dp0"

:: Проверяем, не запущен ли уже сервер на 8080
netstat -ano | findstr ":8080" >nul 2>&1
if %errorlevel%==0 (
    start "" "http://localhost:8080"
    exit /b
)

:: Ищем Python: сначала встроенный (pythonw — без окна), потом системный
set "PYW=%~dp0python\pythonw.exe"
set "PYEXE=%~dp0python\python.exe"
if exist "%PYW%" (
    start "" "%PYW%" -m http.server 8080
) else if exist "%PYEXE%" (
    start /min "" "%PYEXE%" -m http.server 8080
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        start /min "" python -m http.server 8080
    ) else (
        echo Python не найден. Установите Python или используйте встроенную версию.
        pause
        exit /b 1
    )
)

:: Даём серверу секунду подняться
timeout /t 2 /nobreak >nul

:: Открываем браузер
start "" "http://localhost:8080"
