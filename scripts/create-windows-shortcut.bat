@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM AutoMeet - Create Desktop Shortcut on Windows
REM Tao Shortcut ngoai Desktop duoc cau hinh day du co auto-select cho Chrome/Edge
REM ==============================================================================

echo ======================================================
echo    AutoMeet - Tao Desktop Shortcut tren Windows
echo ======================================================
echo.

set "BROWSER_PATH="
set "BROWSER_NAME="

REM 1. Tim kiem Google Chrome (64-bit, 32-bit, User-local)
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
    echo Vui long cai dat Google Chrome hoac Microsoft Edge truoc khi tao shortcut.
    pause
    exit /b 1
)

echo Tim thay trinh duyet: %BROWSER_NAME%
echo Duong dan: "%BROWSER_PATH%"
echo.

REM 3. Xac dinh thu muc Desktop thuc te (ho tro ca OneDrive redirection)
set "DESKTOP_DIR="
for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Desktop 2^>nul`) do (
    set "DESKTOP_DIR=%%B"
)
if defined DESKTOP_DIR (
    call set "DESKTOP_DIR=%DESKTOP_DIR%"
)
if not defined DESKTOP_DIR if exist "%USERPROFILE%\OneDrive\Desktop" (
    set "DESKTOP_DIR=%USERPROFILE%\OneDrive\Desktop"
)
if not defined DESKTOP_DIR (
    set "DESKTOP_DIR=%USERPROFILE%\Desktop"
)

REM Xoa dau gach cheo nguoc cuoi duong dan neu co
if defined DESKTOP_DIR if "!DESKTOP_DIR:~-1!"=="\" set "DESKTOP_DIR=!DESKTOP_DIR:~0,-1!"

set "SHORTCUT_FILE=%DESKTOP_DIR%\AutoMeet Chrome.lnk"
set "ARGS=--auto-select-tab-capture-source-by-title=""Staff"" --auto-select-desktop-capture-source=""Staff"" --auto-select-tab-capture-source-by-title=""Jitsi Meet"" --auto-select-desktop-capture-source=""Jitsi Meet"" https://meet.jit.si/"

echo Dang tao shortcut tai: "%SHORTCUT_FILE%"...

REM Su dung VBScript de tao tap tin .lnk voi uu tien Desktop da phat hien
set "VBS_SCRIPT=%TEMP%\create_automeet_shortcut_%RANDOM%.vbs"
(
    echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
    echo sDesktop = "!DESKTOP_DIR!"
    echo if sDesktop = "" then sDesktop = oWS.SpecialFolders^("Desktop"^)
    echo if sDesktop = "" then sDesktop = "!USERPROFILE!\Desktop"
    echo sLinkFile = sDesktop ^& "\AutoMeet Chrome.lnk"
    echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
    echo oLink.TargetPath = "!BROWSER_PATH!"
    echo oLink.Arguments = "!ARGS!"
    echo oLink.Description = "AutoMeet - Zero-Prompt Tab Capture Jitsi Meet"
    echo oLink.WorkingDirectory = "!USERPROFILE!"
    echo oLink.IconLocation = "!BROWSER_PATH!,0"
    echo oLink.Save
) > "!VBS_SCRIPT!"

cscript //nologo "!VBS_SCRIPT!"
set "VBS_ERR=!ERRORLEVEL!"
del "!VBS_SCRIPT!" 2>nul

REM Neu VBScript loi hoac file chua duoc tao tren dia, thu bang PowerShell
set "NEED_PS=0"
if not "!VBS_ERR!"=="0" set "NEED_PS=1"
if not exist "!SHORTCUT_FILE!" set "NEED_PS=1"

if "!NEED_PS!"=="1" (
    echo VBScript that bai hoac chua tao duoc file, thu tao qua PowerShell...
    set "PS_SCRIPT=%TEMP%\create_automeet_shortcut_%RANDOM%.ps1"
    (
        echo $ws = New-Object -ComObject WScript.Shell
        echo $desk = '!DESKTOP_DIR!'
        echo if ^(-not $desk^) { $desk = $ws.SpecialFolders.Item^('Desktop'^) }
        echo if ^(-not $desk^) { $desk = "$env:USERPROFILE\Desktop" }
        echo $s = $ws.CreateShortcut^("$desk\AutoMeet Chrome.lnk"^)
        echo $s.TargetPath = '!BROWSER_PATH!'
        echo $s.Arguments = '!ARGS!'.Replace^('""', '"'^)
        echo $s.Description = 'AutoMeet - Zero-Prompt Tab Capture Jitsi Meet'
        echo $s.WorkingDirectory = '!USERPROFILE!'
        echo $s.IconLocation = '!BROWSER_PATH!,0'
        echo $s.Save^(^)
    ) > "!PS_SCRIPT!"
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS_SCRIPT!"
    del "!PS_SCRIPT!" 2>nul
)

REM Dong bo shortcut vao ca Local Desktop va OneDrive Desktop (neu ca hai thu muc deu ton tai tren may)
if exist "!SHORTCUT_FILE!" (
    if exist "%USERPROFILE%\OneDrive\Desktop" if not "!DESKTOP_DIR!"=="%USERPROFILE%\OneDrive\Desktop" (
        copy /y "!SHORTCUT_FILE!" "%USERPROFILE%\OneDrive\Desktop\AutoMeet Chrome.lnk" >nul 2>&1
    )
    if exist "%USERPROFILE%\Desktop" if not "!DESKTOP_DIR!"=="%USERPROFILE%\Desktop" (
        copy /y "!SHORTCUT_FILE!" "%USERPROFILE%\Desktop\AutoMeet Chrome.lnk" >nul 2>&1
    )
)

set "CREATED_LINK="
if exist "!SHORTCUT_FILE!" (
    set "CREATED_LINK=!SHORTCUT_FILE!"
) else if exist "%USERPROFILE%\Desktop\AutoMeet Chrome.lnk" (
    set "CREATED_LINK=%USERPROFILE%\Desktop\AutoMeet Chrome.lnk"
) else if exist "%USERPROFILE%\OneDrive\Desktop\AutoMeet Chrome.lnk" (
    set "CREATED_LINK=%USERPROFILE%\OneDrive\Desktop\AutoMeet Chrome.lnk"
)

if defined CREATED_LINK (
    echo.
    echo [THANH CONG] Da tao shortcut "AutoMeet Chrome" tai: "!CREATED_LINK!"
    echo Ban co the khoi dong trinh duyet truc tiep tu Desktop voi day du co bypass auto-select.
) else (
    echo.
    echo [CANH BAO] Khong the tao shortcut ngoai Desktop. Vui long chay voi quyen Administrator.
)

echo.
pause
