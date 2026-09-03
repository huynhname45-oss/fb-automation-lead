@echo off
chcp 65001 >nul 2>&1
title Day Code Len Git
color 0B
cls

cd /d "%~dp0"

echo ==================================================
echo   DAY CODE MOI LEN GIT REPOSITORY
echo ==================================================
echo.

git status --short
echo.

set "commit_msg=Cap nhat code moi"
set /p commit_msg="Nhap noi dung ghi chu (Enter de mac dinh '%commit_msg%'): "

echo.
echo [1/3] Dang them cac file thay doi...
git add .

echo [2/3] Dang commit: "%commit_msg%"...
git commit -m "%commit_msg%"

echo [3/3] Dang day code len Git...
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ==================================================
    echo   [OK] DAY CODE THANH CONG!
    echo   Bay gio tren VPS ban chi can nhap dup file CapNhat_VPS.bat la xong!
    echo ==================================================
) else (
    echo.
    echo [LOI] Khong the push code len Git. Vui long kiem tra lai ket noi hoac quyen truy cap.
)

pause
