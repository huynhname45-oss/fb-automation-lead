@echo off
title FB Automation - Public Web via Cloudflare Tunnel
color 0A
cls

cd /d "%~dp0"

echo =========================================================================
echo   TAO DUONG LINK PUBLIC WEB CHO TOOL TU DONG HOA FACEBOOK
echo =========================================================================
echo.

if not exist "%~dp0cloudflared.exe" (
    echo [DANG TAI] Dang tai Cloudflare Tunnel Portable ve may...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
)

if not exist "%~dp0cloudflared.exe" (
    echo [LOI] Khong the tai cloudflared.exe. Vui long kiem tra ket noi mang.
    pause
    exit /b 1
)

echo [OK] Da san sang! Dang tao duong link HTTPS cong khai...
echo.
echo =========================================================================
echo   LINK WEB CONG KHAI CUA BAN SE XUAT HIEN O BEN DUOI
echo   (Tim dong co chu nhat dang: https://xxxxxx.trycloudflare.com)
echo.
echo   Ban co the copy link do va mo tren dien thoai hoac may tinh bat ky dau!
echo   (Luu y: Can chay file ChayTool.bat song song de server hoat dong)
echo =========================================================================
echo.

"%~dp0cloudflared.exe" tunnel --url http://localhost:3000

pause
