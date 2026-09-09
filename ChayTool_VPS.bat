@echo off
title FB Automation Tool - VPS / Local Runner
color 0B
cls

cd /d "%~dp0"

echo ==================================================
echo   FB AUTOMATION TOOL - CHAY TREN MAY / VPS
echo ==================================================
echo.

:: 1. Check Node.js
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    echo [OK] Da tim thay Node.js Portable trong thu muc tool.
) else (
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_CMD=node"
        echo [OK] Da tim thay Node.js he thong.
    ) else (
        echo [LOI] Thieu Node.js! Vui long cai dat Node.js tren may.
        pause
        exit /b 1
    )
)

if not exist "%~dp0node_modules" (
    echo [CANH BAO] Chua co thu muc node_modules. Dang tu dong cai dat thu vien npm install...
    call npm install
)

where npx >nul 2>nul
if %errorlevel% equ 0 (
    if not exist "%LOCALAPPDATA%\ms-playwright" (
        if not exist "%~dp0browsers" (
            echo [KIEM TRA] Dang tai trinh duyet Chromium cho Playwright...
            call npx playwright install chromium
        )
    )
)

:: 2. Open Windows Firewall for Port 3001
echo [KIEM TRA] Dang mo cong 3001 tren Windows Firewall...
netsh advfirewall firewall add rule name="FB Automation Tool" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1

echo.
echo ==================================================
echo   SERVER DANG CHAY TREN MAY / VPS!
echo ==================================================
echo.
echo   Truy cap truc tiep tren may:    http://localhost:3001
echo   Truy cap tu may khac cung mang: http://[IP_MAY_TINH]:3001
echo.
echo   [GHI CHU] De DUNG tool, dong cua so nay hoac nhan Ctrl+C
echo ==================================================
echo.

:SERVER_LOOP
"%NODE_CMD%" server.js

if exist "%~dp0.restart_flag" (
    del "%~dp0.restart_flag" >nul 2>&1
    echo.
    echo ==================================================
    echo   [HE THONG] DANG KHOI DONG LAI SERVER SAU CAP NHAT...
    echo ==================================================
    timeout /t 2 /nobreak >nul
    goto SERVER_LOOP
)

echo.
echo ==================================================
echo   Server da dung lai. Nhan phim bat ky de thoat.
echo ==================================================
pause
