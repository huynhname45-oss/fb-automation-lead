@echo off
chcp 65001 >nul 2>&1
title Dong Goi FB Automation Tool
color 0E
cls

cd /d "%~dp0"

echo ==================================================
echo   DONG GOI FB AUTOMATION TOOL (Portable Package)
echo ==================================================
echo.

:: Check if 7-Zip or PowerShell is available for zipping
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%i"
set "OUTPUT_NAME=FB_Automation_Portable_%TIMESTAMP%"
set "OUTPUT_ZIP=%~dp0%OUTPUT_NAME%.zip"
set "TEMP_DIR=%TEMP%\%OUTPUT_NAME%"

echo [1/4] Dang tao thu muc tam...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"
mkdir "%TEMP_DIR%\session"
mkdir "%TEMP_DIR%\results"
mkdir "%TEMP_DIR%\exports"
mkdir "%TEMP_DIR%\logs"
mkdir "%TEMP_DIR%\data"

echo [2/4] Dang sao chep cac file can thiet...

:: Core files
copy /y "%~dp0node.exe" "%TEMP_DIR%\" >nul
copy /y "%~dp0server.js" "%TEMP_DIR%\" >nul
copy /y "%~dp0package.json" "%TEMP_DIR%\" >nul
copy /y "%~dp0package-lock.json" "%TEMP_DIR%\" >nul
copy /y "%~dp0config.json" "%TEMP_DIR%\" >nul
copy /y "%~dp0ChayTool.bat" "%TEMP_DIR%\" >nul
copy /y "%~dp0ChayTool_VPS.bat" "%TEMP_DIR%\" >nul
copy /y "%~dp0Public_Web_Cloudflare.bat" "%TEMP_DIR%\" >nul
copy /y "%~dp0eng.traineddata" "%TEMP_DIR%\" >nul

:: Source code
echo    - Copying src\...
xcopy /e /i /q /y "%~dp0src" "%TEMP_DIR%\src" >nul

:: Public web UI
echo    - Copying public\...
xcopy /e /i /q /y "%~dp0public" "%TEMP_DIR%\public" >nul

:: Node modules (essential)
echo    - Copying node_modules\ (co the mat vai phut)...
xcopy /e /i /q /y "%~dp0node_modules" "%TEMP_DIR%\node_modules" >nul

:: Playwright browsers (essential for automation)
echo    - Copying browsers\ (Chromium portable)...
xcopy /e /i /q /y "%~dp0browsers" "%TEMP_DIR%\browsers" >nul

:: Empty session placeholder (user will login on their machine)
echo {} > "%TEMP_DIR%\session\account_info.json"

:: Empty data placeholder
echo {"posts":[]} > "%TEMP_DIR%\data\history.json"

echo [3/4] Dang nen thanh file ZIP...
echo        (Su dung PowerShell Compress-Archive)
echo.

:: Delete old zip if exists
if exist "%OUTPUT_ZIP%" del /f /q "%OUTPUT_ZIP%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path ('%TEMP_DIR%' + '\*') -DestinationPath '%OUTPUT_ZIP%' -Force -CompressionLevel Optimal"

if %errorlevel% neq 0 (
    echo [LOI] Khong the tao file ZIP!
    echo        Ban co the tu nen thu muc tam:
    echo        %TEMP_DIR%
    pause
    exit /b 1
)

echo [4/4] Don dep thu muc tam...
rmdir /s /q "%TEMP_DIR%" >nul 2>&1

echo.
echo ==================================================
echo   DONG GOI THANH CONG!
echo ==================================================
echo.
echo   File ZIP:  %OUTPUT_ZIP%
echo.
echo   HUONG DAN GUI MAY KHAC:
echo   1. Copy file ZIP sang may moi
echo   2. Giai nen vao bat ky thu muc nao
echo   3. Click vao "ChayTool.bat" de chay
echo   4. Dang nhap Facebook khi trinh duyet mo
echo      (Chi can dang nhap 1 lan dau)
echo.
echo ==================================================
echo.
pause
