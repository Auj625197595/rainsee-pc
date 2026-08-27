# Keep electron-builder's shortcut-preservation path enabled during manual
# upgrades. Its allowToChangeInstallationDirectory option disables that path
# unless the installer was launched with --updated, causing the old
# uninstaller to remove taskbar pins via UninstAppUserModelId.
#
# We provide the same directory page ourselves, while leaving that option off.
# Fresh installs can still choose a directory; --updated installs skip it.
!macro customPageAfterChangeDir
  !include StrContains.nsh

  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_DIRECTORY

  # MUI applies this pre-function to the following install-files page. Ensure
  # a directory selected by the user still receives the application subfolder.
  !define MUI_PAGE_CUSTOMFUNCTION_PRE rainseeInstFilesPre
  Function rainseeInstFilesPre
    ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
    ${If} $0 == ""
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
  FunctionEnd
!macroend
