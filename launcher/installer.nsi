; Ages of Command Windows installer (NSIS 3). Built by tools/build_desktop.sh, which passes
; VERSION, STAGE (the folder holding AgesOfCommand.exe and game/) and OUTFILE with -D.
; Installs for the current user only (no administrator rights needed) into
; %LOCALAPPDATA%\Programs\AgesOfCommand. Saves and settings live in %APPDATA%\AgesOfCommand
; and are kept on uninstall unless the player ticks the box to remove them.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"

!define APP "Ages of Command"
!define EXE "AgesOfCommand.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgesOfCommand"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\AgesOfCommand"
InstallDirRegKey HKCU "Software\AgesOfCommand" "InstallDir"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Ages of Command"

!define MUI_ICON "icon\icon.ico"
!define MUI_UNICON "icon\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Play ${APP} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "${APP} (required)" SecGame
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; replace the old game files so removed files do not linger after an update
  RMDir /r "$INSTDIR\game"
  File "${STAGE}\${EXE}"
  File "${STAGE}\README.txt"
  File /r "${STAGE}\game"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  ; the bot plays the player's country while they are away (docs/BOT.md)
  CreateShortcut "$SMPROGRAMS\${APP}\${APP} Bot.lnk" "$INSTDIR\${EXE}" "--bot" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\AgesOfCommand" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Ages of Command"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

Section "un.${APP}" SecUninstall
  SectionIn RO
  ; stop a running copy so its files can be removed
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\game"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\AgesOfCommand"
  ; the game window's browser profile is only a cache
  RMDir /r "$LOCALAPPDATA\AgesOfCommand"
SectionEnd

Section /o "un.Also delete my saved games and settings" SecUnData
  RMDir /r "$APPDATA\AgesOfCommand"
SectionEnd

LangString DESC_Game ${LANG_ENGLISH} "The game and its launcher."
LangString DESC_Desktop ${LANG_ENGLISH} "Put a shortcut on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecGame} $(DESC_Game)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_Desktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END
