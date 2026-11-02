!ifndef ONEWORK_INSTALLER_ERRORS_SENTRY_NSH
!define ONEWORK_INSTALLER_ERRORS_SENTRY_NSH

!include "${PROJECT_DIR}\resources\windows\support\_sentry-dsn.generated.nsh"
!include "${PROJECT_DIR}\resources\windows\installer-messages.nsh"
!include "${PROJECT_DIR}\resources\windows\installer-diagnostics.nsh"

!define ONEWORK_E_UNINSTALLER_COPY_OR_REBUILD_FAILED "E1001"
!define ONEWORK_E_OLD_UNINSTALL_FAILED "E1002"
!define ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED "E1003"
!define ONEWORK_E_EXTRACT_FAILED "E1010"
!define ONEWORK_E_DISK_INSUFFICIENT "E1020"
!define ONEWORK_E_BUNDLED_CORE_INCOMPLETE "E1030"
!define ONEWORK_E_CORE_APP_FILES_INCOMPLETE "E1031"
!define ONEWORK_E_ARCH_MISMATCH "E1040"
!define ONEWORK_E_ACTIVE_INSTALLER_CONFLICT "E1050"
!define ONEWORK_E_REGISTRY_STATE_INVALID "E1060"
!define ONEWORK_E_ACTIVE_MARKER_WRITE_FAILED "E1070"
!define ONEWORK_E_INVALID_INSTALL_PATH "E1090"

!macro ONEWORK_FAIL_UX _CODE _DETAIL _MSG_ZH _MSG_EN _ACTION_ZH _ACTION_EN _DIAGNOSTICS_ZH _DIAGNOSTICS_EN
  !insertmacro ONEWORK_SLOG "event=session-end result=fail code=${_CODE} detail=${_DETAIL}"
  Push $9
  InitPluginsDir
  File /oname=$PLUGINSDIR\onework-show-installer-failure.ps1 "${PROJECT_DIR}\resources\windows\support\show-installer-failure.ps1"
  StrCpy $OneWorkFailureCode "${_CODE}"
  StrCpy $OneWorkFailureDetail "${_DETAIL}"
  StrCpy $OneWorkFailureMessage "${_MSG_ZH}$\r$\n${_MSG_EN}"
  StrCpy $OneWorkFailureAction "${_ACTION_ZH}$\r$\n${_ACTION_EN}"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "$PLUGINSDIR\onework-show-installer-failure.ps1" -LogPath "$OneWorkSessionLogPath" -ExtractLogPath "$OneWorkExtractLogPath" -Code "${_CODE}" -Detail "${_DETAIL}" -MessageZh "${_MSG_ZH}" -MessageEn "${_MSG_EN}" -ActionZh "${_ACTION_ZH}" -ActionEn "${_ACTION_EN}" -Release "${VERSION}" -Arch "${ONEWORK_TARGET_ARCH}" -Session "$OneWorkSessionId" -InstallDir "$INSTDIR" -InstallerPath "$EXEPATH" -Language "$LANGUAGE" -ResultPath "$PLUGINSDIR\onework-diagnostics-path.txt" -NoUi`
  Pop $9
  StrCpy $OneWorkDiagnosticsPath "Diagnostic collection failed (exit=$9)"
  ${If} $9 == "0"
    Push $0
    FileOpen $0 "$PLUGINSDIR\onework-diagnostics-path.txt" r
    FileSeek $0 2 SET ; UTF-16LE BOM
    FileReadUTF16LE $0 $OneWorkDiagnosticsPath
    FileClose $0
    Pop $0
  ${EndIf}
  ${If} ${Silent}
    !insertmacro ONEWORK_SLOG "event=report-auto reason=silent code=${_CODE}"
    !insertmacro ONEWORK_REPORT_TO_SENTRY_NOUI "${_CODE}" "${_DETAIL}"
  ${Else}
    ${If} $9 == "0"
      !ifdef BUILD_UNINSTALLER
        Call un.OneWorkShowInstallerDiagnostics
      !else
        Call OneWorkShowInstallerDiagnostics
      !endif
      StrCpy $9 $OneWorkFailureDialogResult
    ${Else}
      ; A blocked PowerShell or failed diagnostic write still leaves actionable text.
      MessageBox MB_OK|MB_ICONSTOP "One Work installation failed (${_CODE})$\r$\n$OneWorkFailureMessage$\r$\n$OneWorkFailureDetail$\r$\nInstaller log: $OneWorkSessionLogPath$\r$\n$OneWorkDiagnosticsPath$\r$\nCtrl+C: 复制此信息 / Copy this information" /SD IDOK
      StrCpy $9 "0"
    ${EndIf}
    ${If} $9 == "10"
      !insertmacro ONEWORK_REPORT_TO_SENTRY "${_CODE}" "${_DETAIL}"
    ${Else}
      !insertmacro ONEWORK_SLOG "event=report-skipped reason=user-declined code=${_CODE}"
    ${EndIf}
  ${EndIf}
  Pop $9
  !insertmacro ONEWORK_CLEAR_ACTIVE_INSTALLER_MARKER
  SetErrorLevel 2
  Quit
!macroend

!macro ONEWORK_FAIL_REPORTABLE _CODE _DETAIL _MSG_EN _ACTION_EN
  !insertmacro ONEWORK_FAIL_UX ${_CODE} "${_DETAIL}" "${ONEWORK_MSG_GENERIC_FAILURE_ZH}" "${_MSG_EN}" "${ONEWORK_MSG_GENERIC_ACTION_ZH}" "${_ACTION_EN}" "${_DETAIL}" "${_DETAIL}"
!macroend

!macro ONEWORK_FAIL_REPORTABLE_ROOTED _ROOT_CODE _WRAPPER_CODE _DETAIL _MSG_EN _ACTION_EN
  !insertmacro ONEWORK_FAIL_UX "${_ROOT_CODE}" "wrapperCode=${_WRAPPER_CODE} ${_DETAIL}" "${ONEWORK_MSG_GENERIC_FAILURE_ZH}" "${_MSG_EN}" "${ONEWORK_MSG_GENERIC_ACTION_ZH}" "${_ACTION_EN}" "${_DETAIL}" "${_DETAIL}"
!macroend

!macro ONEWORK_FAIL_REPORTABLE_BILINGUAL _CODE _DETAIL _MSG_EN _MSG_ZH _ACTION_EN _ACTION_ZH
  !insertmacro ONEWORK_FAIL_UX ${_CODE} "${_DETAIL}" "${_MSG_ZH}" "${_MSG_EN}" "${_ACTION_ZH}" "${_ACTION_EN}" "${_DETAIL}" "${_DETAIL}"
!macroend

!macro ONEWORK_FAIL_REPORTABLE_ROOTED_BILINGUAL _ROOT_CODE _WRAPPER_CODE _DETAIL _MSG_EN _MSG_ZH _ACTION_EN _ACTION_ZH
  !insertmacro ONEWORK_FAIL_UX "${_ROOT_CODE}" "wrapperCode=${_WRAPPER_CODE} ${_DETAIL}" "${_MSG_ZH}" "${_MSG_EN}" "${_ACTION_ZH}" "${_ACTION_EN}" "${_DETAIL}" "${_DETAIL}"
!macroend

!macro ONEWORK_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS _CODE _DETAIL _MSG_EN _MSG_ZH _ACTION_EN _ACTION_ZH _DIAGNOSTICS_EN _DIAGNOSTICS_ZH
  !insertmacro ONEWORK_FAIL_UX ${_CODE} "${_DETAIL}" "${_MSG_ZH}" "${_MSG_EN}" "${_ACTION_ZH}" "${_ACTION_EN}" "${_DIAGNOSTICS_ZH}" "${_DIAGNOSTICS_EN}"
!macroend

!macro ONEWORK_FAIL_REPORTABLE_ROOTED_BILINGUAL_DIAGNOSTICS _ROOT_CODE _WRAPPER_CODE _DETAIL _MSG_EN _MSG_ZH _ACTION_EN _ACTION_ZH _DIAGNOSTICS_EN _DIAGNOSTICS_ZH
  !insertmacro ONEWORK_FAIL_UX "${_ROOT_CODE}" "wrapperCode=${_WRAPPER_CODE} ${_DETAIL}" "${_MSG_ZH}" "${_MSG_EN}" "${_ACTION_ZH}" "${_ACTION_EN}" "${_DIAGNOSTICS_ZH}" "${_DIAGNOSTICS_EN}"
!macroend

!macro ONEWORK_REPORT_TO_SENTRY _CODE _DETAIL
  !insertmacro ONEWORK_REPORT_TO_SENTRY_IMPL "${_CODE}" "${_DETAIL}" ""
!macroend

!macro ONEWORK_REPORT_TO_SENTRY_NOUI _CODE _DETAIL
  !insertmacro ONEWORK_REPORT_TO_SENTRY_IMPL "${_CODE}" "${_DETAIL}" "-NoUi"
!macroend

!macro ONEWORK_REPORT_TO_SENTRY_IMPL _CODE _DETAIL _NO_UI
  Push $9
  InitPluginsDir
  File /oname=$PLUGINSDIR\onework-report-installer-failure.ps1 "${PROJECT_DIR}\resources\windows\support\report-installer-failure.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\onework-report-installer-failure.ps1" -Dsn "${ONEWORK_SENTRY_DSN}" -LogPath "$OneWorkSessionLogPath" -Code "${_CODE}" -Detail "${_DETAIL}" -Release "${VERSION}" -Arch "${ONEWORK_TARGET_ARCH}" -Session "$OneWorkSessionId" -Updated "$OneWorkIsUpdated" ${_NO_UI}`
  Pop $9
  Pop $9
!macroend

!endif
