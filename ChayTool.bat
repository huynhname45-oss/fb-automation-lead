@echo off
chcp 65001 >nul 2>&1
title FB Automation Tool
color 0A
cls

:: Always cd to the folder containing this .bat file
cd /d "%~dp0"

echo ==================================================
echo      CONG CU TU DONG HOA CAO DULIEU FACEBOOK
echo ==================================================
echo.

:: Use portable node.exe bundled in this folder
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    echo [OK] Phat hien Node.js portable trong thu muc tool.
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [LOI] Khong tim thay Node.js!
        echo        Thu muc tool thieu file node.exe.
        echo        Vui long kiem tra lai ban tai tool.
        echo.
        pause
        exit /b 1
    )
    set "NODE_CMD=node"
    echo [OK] Su dung Node.js he thong.
)

:: Verify node_modules exists
if not exist "%~dp0node_modules" (
    echo [LOI] Thu muc node_modules khong ton tai!
    echo        Ban tai tool bi thieu thu vien. Vui long tai lai.
    echo.
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
