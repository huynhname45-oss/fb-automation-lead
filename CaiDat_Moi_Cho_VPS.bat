@echo off
chcp 65001 >nul 2>&1
title Cai Dat Tu Dong Git va Node.js cho VPS
color 0B
cls

echo ==================================================
echo   TU DONG CAI DAT GIT VA NODE.JS CHO VPS WINDOWS
echo ==================================================
echo.

:: 1. Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Node.js da duoc cai dat tren he thong.
    node -v
) else (
    echo [1/2] Dang tai va cai dat Node.js LTS tu dong...
    where curl.exe >nul 2>nul
    if %errorlevel% equ 0 (
        curl.exe -o "%temp%\nodejs.msi" -L "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
    ) else (
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi', '%temp%\nodejs.msi')"
    )
    if exist "%temp%\nodejs.msi" (
        echo Dang cai dat Node.js ngam (vui long doi giay lat)...
        msiexec /i "%temp%\nodejs.msi" /qn /norestart
        del "%temp%\nodejs.msi" >nul 2>&1
        echo [OK] Da cai dat xong Node.js!
    ) else (
        echo [LOI] Khong the tai bo cai Node.js. Vui long kiem tra ket noi mang.
    )
)

echo.

:: 2. Kiem tra Git
where git >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Git da duoc cai dat tren he thong.
    git --version
) else (
    echo [2/2] Dang tai va cai dat Git cho Windows tu dong...
    where curl.exe >nul 2>nul
    if %errorlevel% equ 0 (
        curl.exe -o "%temp%\git_setup.exe" -L "https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/Git-2.46.2-64-bit.exe"
    ) else (
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/Git-2.46.2-64-bit.exe', '%temp%\git_setup.exe')"
    )
    if exist "%temp%\git_setup.exe" (
        echo Dang cai dat Git ngam (vui long doi giay lat)...
        "%temp%\git_setup.exe" /VERYSILENT /NORESTART /NOCANCEL /SP-
        del "%temp%\git_setup.exe" >nul 2>&1
        echo [OK] Da cai dat xong Git!
    ) else (
        echo [LOI] Khong the tai bo cai Git. Vui long kiem tra ket noi mang.
    )
)

echo.
echo ==================================================
echo   [HOAN TAT] DA CAI XONG GIT VA NODE.JS!
echo.
echo   Luu y: Vui long DONG cua so nay va mo lai
echo   de he dieu hanh Windows cap nhat bien moi truong.
echo   Sau do ban co the chay CapNhat_VPS.bat binh thuong.
echo ==================================================
pause
