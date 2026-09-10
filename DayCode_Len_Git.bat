@echo off
chcp 65001 >nul 2>&1
title Day Code Len Git Repository
color 0B
cls

cd /d "%~dp0"

echo ==================================================
echo   FB AUTOMATION - DAY CODE LEN GITHUB
echo ==================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 goto :ERR_NO_GIT

if not exist "%~dp0.git" goto :ERR_NO_REPO

echo [1/3] Kiem tra thay doi ma nguon...
git add .

git diff --staged --quiet
if %errorlevel% equ 0 goto :NO_CHANGES_TO_COMMIT

echo.
echo [PHAT HIEN THAY DOI] Danh sach file da sua:
git status --short
echo.
set "commit_msg=Cap nhat code moi"
set /p commit_msg="Nhap ghi chu commit (Enter de mac dinh '%commit_msg%'): "
echo.
echo [2/3] Dang tao commit moi tren may...
git commit -m "%commit_msg%"
goto :DO_PUSH

:NO_CHANGES_TO_COMMIT
echo [THONG BAO] Khong co file code nao vua sua doi can commit moi.
goto :DO_PUSH

:DO_PUSH
echo.
echo [2/3] Thong tin commit hien tai tren may ban:
git log -1 --format="  Commit: %%h - %%s"
git log -1 --format="  Thoi gian: %%cd" --date=format:"%%d/%%m/%%Y %%H:%%M:%%S"

echo.
echo [3/3] Dang ket noi va day code len GitHub (origin/main)...
git push origin main
if %errorlevel% equ 0 goto :PUSH_OK
goto :PUSH_FAIL

:PUSH_OK
echo.
echo ==================================================
echo   [THANH CONG] CODE DA DUOC DONG BO LEN GITHUB!
echo.
echo   - Toan bo ma nguon tren may da dong bo len GitHub.
echo   - Tat ca Client mo Web se nhan pop-up thong bao
echo     va co the bam [Cap Nhat Ngay] tren giao dien!
echo   - May VPS chi can chay CapNhat_VPS.bat la xong.
echo ==================================================
goto :END

:PUSH_FAIL
echo.
echo ==================================================
echo   [LOI] KHONG THE DAY CODE LEN GITHUB!
echo.
echo   Vui long kiem tra:
echo     1. Ket noi Internet tren may.
echo     2. Quyen truy cap Git hoac tai khoan GitHub.
echo     3. Neu tren GitHub co commit moi hon, hay go lenh:
echo        git pull --rebase origin main
echo ==================================================
goto :END

:ERR_NO_GIT
echo [LOI] Khong tim thay Git trong he thong PATH!
echo Vui long cai dat Git hoac them thu muc Git vao PATH.
goto :END

:ERR_NO_REPO
echo [LOI] Thu muc nay chua duoc ket noi voi Git!
goto :END

:END
echo.
echo Nhan phim bat ky de dong cua so nay...
pause >nul
