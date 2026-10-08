@echo off
REM ==============================================================================
REM Script khoi chay Google Chrome tren Windows tu dong cap quyen Tab Capture (Bypass Allow)
REM ==============================================================================

set "CHROME_PATH="

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
    echo Khong tim thay Google Chrome tren he thong.
    pause
    exit /b 1
)

echo Dang khoi chay Chrome voi che do Tu dong cap quyen Tab Capture...
start "" "%CHROME_PATH%" --auto-select-desktop-capture-source="Jitsi Meet" --use-fake-ui-for-media-stream --enable-usermedia-screen-capturing https://meet.jit.si/
