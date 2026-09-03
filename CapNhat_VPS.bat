@echo off
chcp 65001 >nul 2>&1
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
    echo [LOI] Tren VPS chua cai dat Git!
    echo Vui long tai va cai dat Git cho Windows tu: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [1/2] Dang tai code moi nhat tu Git...
git pull origin main

echo.
echo ==================================================
echo   [OK] CAP NHAT THANH CONG!
echo   Hay khoi dong lai file ChayTool_VPS.bat de ap dung code moi.
echo ==================================================
pause
