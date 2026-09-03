@echo off
chcp 65001 >nul 2>&1
title FB Automation Tool - VPS Runner
color 0B
cls

cd /d "%~dp0"

echo ==================================================
echo   FB AUTOMATION TOOL - CHAY TREN VPS WINDOWS
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
        echo [LOI] Thieu file node.exe trong thu muc tool!
        pause
        exit /b 1
    )
)

:: 2. Open Windows Firewall for Port 3000
echo [KIEM TRA] Dang mo cong 3000 tren Windows Firewall...
netsh advfirewall firewall add rule name="FB Automation Tool" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1

echo.
echo ==================================================
echo   SERVER DANG CHAY TREN VPS!
echo ==================================================
echo.
echo   Truy cap truc tiep tren VPS:  http://localhost:3000
echo   Truy cap tu may ca nhan/dt:   http://[IP_CUA_VPS]:3000
echo.
echo   [GHI CHU] De DUNG tool, dong cua so nay hoac nhan Ctrl+C
echo ==================================================
echo.

"%NODE_CMD%" server.js

echo.
echo ==================================================
echo   Server da dung lai. Nhan phim bat ky de thoat.
echo ==================================================
pause
