@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM AutoMeet - Windows Browser Auto-Launch Script
REM Tu dong cap quyen Tab Capture (Bypass popup Allow) cho Google Chrome & Edge
REM ==============================================================================

set "BROWSER_PATH="
set "BROWSER_NAME="

REM 1. Kiem tra Google Chrome (64-bit, 32-bit, User-local)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (64-bit)"
) else if exist "%ProgramW6432%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%ProgramW6432%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (64-bit)"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (32-bit)"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome (User-local)"
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    set "BROWSER_NAME=Google Chrome"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (64-bit)"
) else if exist "%ProgramW6432%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=%ProgramW6432%\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (64-bit)"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge"
) else if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge (User-local)"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    set "BROWSER_NAME=Microsoft Edge"
)

REM 2. Fallback qua Windows Registry App Paths neu chua tim thay o cac duong dan tieu chuan
if "%BROWSER_PATH%"=="" (
    for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul`) do (
        if exist "%%B" (
            set "BROWSER_PATH=%%B"
            set "BROWSER_NAME=Google Chrome (Registry App Paths)"
        )
    )
)
if "%BROWSER_PATH%"=="" (
    for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul`) do (
        if exist "%%B" (
            set "BROWSER_PATH=%%B"
            set "BROWSER_NAME=Google Chrome (User App Paths)"
        )
    )
)
if "%BROWSER_PATH%"=="" (
    for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" /ve 2^>nul`) do (
        if exist "%%B" (
            set "BROWSER_PATH=%%B"
            set "BROWSER_NAME=Microsoft Edge (Registry App Paths)"
        )
    )
)

if "%BROWSER_PATH%"=="" (
    echo [LOI] Khong tim thay Google Chrome hoac Microsoft Edge tren he thong.
    echo Vui long cai dat Google Chrome hoac Microsoft Edge de su dung AutoMeet.
    pause
    exit /b 1
)

set "TARGET_URL=%~1"
if "%TARGET_URL%"=="" set "TARGET_URL=https://meet.jit.si/"

echo Dang khoi chay %BROWSER_NAME% voi che do Tu dong cap quyen Tab Capture...
echo Duong dan: "%BROWSER_PATH%"
echo URL phong: "%TARGET_URL%"

start "" "%BROWSER_PATH%" ^
    --auto-select-tab-capture-source-by-title="Staff" ^
    --auto-select-desktop-capture-source="Staff" ^
    --auto-select-tab-capture-source-by-title="Jitsi Meet" ^
    --auto-select-desktop-capture-source="Jitsi Meet" ^
    "%TARGET_URL%"
