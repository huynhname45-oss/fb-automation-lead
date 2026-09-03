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
    echo [1/2] Đang tải mã nguồn mới nhất từ GitHub...
    git fetch origin main
    git reset --hard origin/main
    echo [OK] Đã kết nối và đồng bộ xong toàn bộ mã nguồn!
) else (
    echo [1/2] Đang tải code mới nhất từ Git...
    git pull origin main
)

echo.
echo ==================================================
echo   [OK] CẬP NHẬT THÀNH CÔNG!
echo   Vui lòng khởi động lại file ChayTool_VPS.bat để áp dụng code mới.
echo ==================================================
pause
