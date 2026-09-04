@echo off
title FB Automation Tool
color 0A
cls

cd /d "%~dp0"

echo ==================================================
echo      CONG CU TU DONG HOA CAO DULIEU FACEBOOK
echo ==================================================
echo.

if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    echo [OK] Phat hien Node.js portable trong thu muc tool.
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [LOI] Khong tim thay Node.js he thong!
        pause
        exit /b 1
    )
    set "NODE_CMD=node"
    echo [OK] Su dung Node.js he thong.
)

if not exist "%~dp0node_modules" (
    echo [LOI] Thu muc node_modules khong ton tai!
    pause
    exit /b 1
)

echo.
echo [DANG KHOI DONG] Mo server va trinh duyet...
echo [GHI CHU] De DUNG tool, dong cua so nay hoac nhan Ctrl+C
echo.

"%NODE_CMD%" server.js

echo.
echo ==================================================
echo   Tool da dung lai. Dong cua so nay de thoat.
echo ==================================================
pause
