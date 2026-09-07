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
    echo [LỖI] Trên VPS chưa cài đặt Git!
    echo Vui lòng tải và cài đặt Git cho Windows tại: https://git-scm.com/download/win
    echo (Chỉ cần tải về bấm Next đến hết để cài).
    pause
    exit /b 1
)

if not exist "%~dp0.git" (
    echo [THIẾT LẬP LẦN ĐẦU] Đang kết nối thư mục VPS với Git Repository...
    git init -b main
    git remote add origin https://github.com/huynhname45-oss/fb-automation-lead.git
    echo [1/3] Đang tải mã nguồn mới nhất từ GitHub...
    git fetch origin main
    git reset --hard origin/main
    echo [OK] Đã kết nối và đồng bộ xong toàn bộ mã nguồn!
) else (
    echo [1/3] Đang tải code mới nhất từ Git...
    git pull origin main
)

echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%~dp0node.exe" (
        echo [LƯU Ý] Chưa tìm thấy Node.js trên VPS!
        echo Để chạy được tool, vui lòng tải và cài đặt Node.js LTS tại: https://nodejs.org
        echo Hoặc copy file node.exe từ máy bạn sang thư mục này.
        echo.
    )
)

if not exist "%~dp0node_modules" (
    echo [2/3] Đang tự động cài đặt các thư viện cần thiết (npm install)...
    call npm install
) else (
    echo [2/3] Thư viện node_modules đã sẵn sàng.
)

if not exist "%~dp0browsers" (
    echo [3/3] Đang cài đặt trình duyệt Chromium cho Playwright...
    call npx playwright install chromium
) else (
    echo [3/3] Trình duyệt Chromium đã sẵn sàng.
)

echo.
echo ==================================================
echo   [OK] HOÀN TẤT ĐỒNG BỘ VÀ CÀI ĐẶT TRÊN VPS!
echo   Vui lòng khởi động lại file ChayTool_VPS.bat để bắt đầu.
echo ==================================================
pause
