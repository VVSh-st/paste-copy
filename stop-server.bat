@echo off
echo Останавливаю сервер...

:: Убиваем все процессы python.exe и pythonw.exe
taskkill /f /im python.exe 2>nul
taskkill /f /im pythonw.exe 2>nul

:: Ждём и проверяем по порту
timeout /t 1 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul

timeout /t 1 /nobreak >nul
netstat -ano | findstr ":8080" >nul 2>&1
if %errorlevel%==0 (
    echo Сервер всё ещё работает на порту 8080
) else (
    echo Сервер остановлен.
)
