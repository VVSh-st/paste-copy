@echo off
setlocal

if not exist "%~dp0Backup" mkdir "%~dp0Backup"

for /f %%I in ('powershell -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"') do set "timestamp=%%I"

set "archive=%~dp0Backup\backup-%timestamp%.zip"

powershell -Command "Compress-Archive -Path '%~dp0*.js','%~dp0*.css','%~dp0*.html','%~dp0*.vbs','%~dp0*.bat' -DestinationPath '%archive%' -Force"

if exist "%archive%" (
    echo Backup created: %archive%
) else (
    echo Archive was not created
)
pause
