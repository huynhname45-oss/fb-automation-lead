@echo off
chcp 65001 >nul 2>&1
title FB Automation - Public Web via Cloudflare Tunnel
color 0A
cls

cd /d "%~dp0"

echo ==================================================
echo   TAO DUONG LINK PUBLIC WEB CHO TOOL TU DONG
echo ==================================================
echo.

if not exist "%~dp0cloudflared.exe" (
    echo [DANG TAI] Dang tai Cloudflare Tunnel Portable (Chi mat 5s)...
    powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
)

if not exist "%~dp0cloudflared.exe" (
    echo [LOI] Khong the tai cloudflared.exe. Vui long kiem tra ket noi mang.
    pause
    exit /b 1
)

echo [OK] Dang tao duong link HTTPS cong khai...
echo.
echo =========================================================================
echo   LINK WEB CÔNG KHAI CỦA BẠN SẼ XUẤT HIỆN Ở BÊN DƯỚI (Dạng https://xxx.trycloudflare.com)
echo   Bạn có thể mở link này trên điện thoại hoặc máy tính cá nhân ở bất cứ đâu!
echo =========================================================================
echo.

"%~dp0cloudflared.exe" tunnel --url http://localhost:3000

pause
