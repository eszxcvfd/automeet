' ==============================================================================
' AutoMeet - Create Desktop Shortcut on Windows (VBScript Standalone)
' Tao Shortcut ngoai Desktop duoc cau hinh day du co auto-select cho Chrome/Edge
' ==============================================================================

Option Explicit

Dim oWS, oFSO, sBrowserPath, sBrowserName
Set oWS = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")

sBrowserPath = ""
sBrowserName = ""

Dim sProgFiles, sProgW6432, sProgX86, sLocalApp, sUserProfile
sProgFiles = oWS.ExpandEnvironmentStrings("%ProgramFiles%")
sProgW6432 = oWS.ExpandEnvironmentStrings("%ProgramW6432%")
sProgX86 = oWS.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
sLocalApp = oWS.ExpandEnvironmentStrings("%LocalAppData%")
sUserProfile = oWS.ExpandEnvironmentStrings("%USERPROFILE%")

' 1. Kiem tra Google Chrome
If sProgFiles <> "%ProgramFiles%" And oFSO.FileExists(sProgFiles & "\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = sProgFiles & "\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome (64-bit)"
ElseIf sProgW6432 <> "%ProgramW6432%" And oFSO.FileExists(sProgW6432 & "\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = sProgW6432 & "\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome (64-bit)"
ElseIf sProgX86 <> "%ProgramFiles(x86)%" And oFSO.FileExists(sProgX86 & "\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = sProgX86 & "\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome (32-bit)"
ElseIf sLocalApp <> "%LocalAppData%" And oFSO.FileExists(sLocalApp & "\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = sLocalApp & "\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome (User-local)"
ElseIf oFSO.FileExists("C:\Program Files\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome"
ElseIf oFSO.FileExists("C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") Then
    sBrowserPath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    sBrowserName = "Google Chrome"

' 2. Kiem tra Microsoft Edge
ElseIf sProgFiles <> "%ProgramFiles%" And oFSO.FileExists(sProgFiles & "\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = sProgFiles & "\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge (64-bit)"
ElseIf sProgW6432 <> "%ProgramW6432%" And oFSO.FileExists(sProgW6432 & "\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = sProgW6432 & "\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge (64-bit)"
ElseIf sProgX86 <> "%ProgramFiles(x86)%" And oFSO.FileExists(sProgX86 & "\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = sProgX86 & "\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge"
ElseIf sLocalApp <> "%LocalAppData%" And oFSO.FileExists(sLocalApp & "\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = sLocalApp & "\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge (User-local)"
ElseIf oFSO.FileExists("C:\Program Files\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge"
ElseIf oFSO.FileExists("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") Then
    sBrowserPath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    sBrowserName = "Microsoft Edge"
End If

' 3. Fallback qua Windows Registry App Paths
If sBrowserPath = "" Then
    On Error Resume Next
    Dim sRegChrome
    sRegChrome = oWS.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\")
    If oFSO.FileExists(sRegChrome) Then
        sBrowserPath = sRegChrome
        sBrowserName = "Google Chrome (Registry)"
    End If
    If sBrowserPath = "" Then
        Dim sRegEdge
        sRegEdge = oWS.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe\")
        If oFSO.FileExists(sRegEdge) Then
            sBrowserPath = sRegEdge
            sBrowserName = "Microsoft Edge (Registry)"
        End If
    End If
    On Error GoTo 0
End If

If sBrowserPath = "" Then
    MsgBox "Khong tim thay Google Chrome hoac Microsoft Edge tren may tinh." & vbCrLf & _
           "Vui long cai dat Google Chrome hoac Microsoft Edge truoc khi tao shortcut.", vbCritical, "AutoMeet - Loi"
    WScript.Quit 1
End If

' 4. Xac dinh thu muc Desktop chinh xac (ho tro ca OneDrive redirection)
Dim sDesktopDir
sDesktopDir = ""
On Error Resume Next
sDesktopDir = oWS.RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders\Desktop")
On Error GoTo 0

If sDesktopDir <> "" Then
    sDesktopDir = oWS.ExpandEnvironmentStrings(sDesktopDir)
End If

If sDesktopDir = "" Or Not oFSO.FolderExists(sDesktopDir) Then
    If oFSO.FolderExists(sUserProfile & "\OneDrive\Desktop") Then
        sDesktopDir = sUserProfile & "\OneDrive\Desktop"
    Else
        sDesktopDir = oWS.SpecialFolders("Desktop")
    End If
End If

If sDesktopDir = "" Or Not oFSO.FolderExists(sDesktopDir) Then
    sDesktopDir = sUserProfile & "\Desktop"
End If

' Xoa dau gach cheo cuoi neu co
If Right(sDesktopDir, 1) = "\" Then
    sDesktopDir = Left(sDesktopDir, Len(sDesktopDir) - 1)
End If

' 5. Tao shortcut voi day du 4 co auto-select
Dim sLinkPath, sArgs, oLink
sLinkPath = sDesktopDir & "\AutoMeet Chrome.lnk"
sArgs = "--auto-select-tab-capture-source-by-title=""Staff"" --auto-select-desktop-capture-source=""Staff"" --auto-select-tab-capture-source-by-title=""Jitsi Meet"" --auto-select-desktop-capture-source=""Jitsi Meet"" https://meet.jit.si/"

Set oLink = oWS.CreateShortcut(sLinkPath)
oLink.TargetPath = sBrowserPath
oLink.Arguments = sArgs
oLink.Description = "AutoMeet - Zero-Prompt Tab Capture Jitsi Meet"
oLink.WorkingDirectory = sUserProfile
oLink.IconLocation = sBrowserPath & ",0"
oLink.Save

' 6. Dong bo link sang ca Local Desktop va OneDrive Desktop neu ca hai ton tai
If oFSO.FileExists(sLinkPath) Then
    Dim sOneDriveDesk, sLocalDesk
    sOneDriveDesk = sUserProfile & "\OneDrive\Desktop"
    sLocalDesk = sUserProfile & "\Desktop"
    If oFSO.FolderExists(sOneDriveDesk) And LCase(sDesktopDir) <> LCase(sOneDriveDesk) Then
        On Error Resume Next
        oFSO.CopyFile sLinkPath, sOneDriveDesk & "\AutoMeet Chrome.lnk", True
        On Error GoTo 0
    End If
    If oFSO.FolderExists(sLocalDesk) And LCase(sDesktopDir) <> LCase(sLocalDesk) Then
        On Error Resume Next
        oFSO.CopyFile sLinkPath, sLocalDesk & "\AutoMeet Chrome.lnk", True
        On Error GoTo 0
    End If

    WScript.Echo "[THANH CONG] Da tao Desktop Shortcut AutoMeet Chrome tai: " & sLinkPath
Else
    MsgBox "Khong the tao shortcut tai: " & sLinkPath, vbExclamation, "AutoMeet - Canh bao"
End If
