@echo off
title Cap Nhat FB Automation Tool Tren VPS
color 0A
cls

cd /d "%~dp0"

echo ==================================================
echo   FB AUTOMATION TOOL - CAP NHAT CODE QUA GIT
echo ==================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Tren VPS chua tim thay Git trong PATH!
    echo Vui long mo lai cua so moi sau khi cai Git.
    pause
    exit /b 1
)

if not exist "%~dp0.git" (
    echo [THIET LAP LAN DAU] Dang ket noi thu muc VPS voi Git Repository...
    git init -b main
    git remote add origin https://github.com/huynhname45-oss/fb-automation-lead.git
    echo [1/3] Dang tai ma nguon moi nhat tu GitHub...
    git fetch origin main
    git reset --hard origin/main
    echo [OK] Da ket noi va dong bo xong toan bo ma nguon!
) else (
    echo [1/3] Dang tai code moi nhat tu Git...
    git pull origin main
)

echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%~dp0node.exe" (
        echo [CANH BAO] Chua tim thay Node.js trong PATH he thong!
        echo Vui long kiem tra lai Node.js hoac khoi dong lai VPS.
        echo.
    )
)

if not exist "%~dp0node_modules" (
    echo [2/3] Dang cai dat cac thu vien can thiet: npm install...
    call npm install
) else (
    echo [2/3] Thu vien node_modules da san sang.
)

if not exist "%~dp0browsers" (
    echo [3/3] Dang cai dat trinh duyet Chromium cho Playwright...
    call npx playwright install chromium
) else (
    echo [3/3] Trinh duyet Chromium da san sang.
)

echo.
echo ==================================================
echo   [OK] HOAN TAT DONG BO VA CAI DAT TREN VPS!
echo   Vui long khoi dong file ChayTool_VPS.bat de bat dau.
echo ==================================================
pause
