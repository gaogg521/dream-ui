!ifndef ONEWORK_INSTALLER_REPAIR_HEAL_NSH
!define ONEWORK_INSTALLER_REPAIR_HEAL_NSH

Var /GLOBAL OneWorkRegistryInstallIsValid
Var /GLOBAL OneWorkInnerFailureSummary
Var /GLOBAL OneWorkInnerRootCode
Var /GLOBAL OneWorkInnerFailureReadResult

!macro ONEWORK_READ_LAST_INNER_FAILURE
  InitPluginsDir
  StrCpy $OneWorkInnerRootCode ""
  StrCpy $OneWorkInnerFailureSummary "No specific locking process was identified. Close One Work, terminals, editors, and file managers opened in the install folder."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$logPath = '$OneWorkSessionLogPath'; \
    $$summary = 'No specific locking process was identified. Close One Work, terminals, editors, and file managers opened in the install folder.'; \
    $$code = ''; \
    if ($$logPath -and (Test-Path -LiteralPath $$logPath)) { \
      $$events = @(Get-Content -LiteralPath $$logPath -ErrorAction SilentlyContinue | ForEach-Object { try { $$_ | ConvertFrom-Json } catch { $$null } } | Where-Object { $$_ }); \
      $$failure = @($$events | Where-Object { $$_.event -eq 'failure' -and $$_.updated -eq $$true } | Select-Object -Last 1)[0]; \
      if (-not $$failure) { $$failure = @($$events | Where-Object { $$_.event -eq 'failure' } | Select-Object -Last 1)[0] }; \
      if ($$failure) { \
        $$code = ([string]$$failure.code).Trim(); \
        $$phase = ([string]$$failure.phase).Trim(); \
        $$path = ([string]$$failure.failedPath).Trim(); \
        $$blocking = ''; \
        $$processes = @($$failure.blockingProcesses); \
        if ($$processes.Count -gt 0) { $$blocking = (@($$processes | ForEach-Object { if ($$_.pid) { [string]$$_.name + '(' + [string]$$_.pid + ')' } else { [string]$$_.name } }) -join ', ') }; \
        if (-not $$blocking) { $$blocking = ([string]$$failure.message).Trim() }; \
        if (-not $$blocking) { $$blocking = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        $$parts = @('- Outer installer: previous uninstaller exited with code $R0', ('- Inner failure: ' + $$code + ' phase ' + $$phase)); \
        if ($$path) { $$parts += ('- File or folder: ' + $$path) }; \
        $$parts += ('- Blocking process: ' + $$blocking); \
        $$summary = $$parts -join [Environment]::NewLine; \
      } \
    }; \
    if (-not $$code) { $$code = '-----' }; \
    [Console]::Out.Write($$code + '|' + $$summary) \
  }"`
  Pop $OneWorkInnerFailureReadResult
  Pop $OneWorkInnerFailureReadResult
  StrCpy $OneWorkInnerRootCode $OneWorkInnerFailureReadResult 5
  ${If} $OneWorkInnerRootCode == "-----"
    StrCpy $OneWorkInnerRootCode ""
  ${EndIf}
  StrCpy $OneWorkInnerFailureSummary $OneWorkInnerFailureReadResult 4096 6
!macroend

!macro ONEWORK_LOG_UNINSTALLER_REPAIR _PHASE
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$path = '$INSTDIR\${UNINSTALL_FILENAME}'; \
    $$item = Get-Item -LiteralPath $$path -ErrorAction SilentlyContinue; \
    $$version = if ($$item) { $$item.VersionInfo.ProductVersion } else { '' }; \
    $$length = if ($$item) { $$item.Length } else { '' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstaller-repair'; phase = '${_PHASE}'; path = $$path; exists = [bool]$$item; productVersion = $$version; length = $$length }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $OneWorkRepairLogResult
!macroend

!macro ONEWORK_REPAIR_INSTALLED_UNINSTALLER
  Var /GLOBAL OneWorkInstalledUninstaller
  Var /GLOBAL OneWorkBundledUninstaller
  Var /GLOBAL OneWorkRepairLogResult

  !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "before"
  StrCpy $OneWorkInstalledUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  InitPluginsDir
  StrCpy $OneWorkBundledUninstaller "$PLUGINSDIR\onework-fixed-uninstaller.exe"
  SetOverwrite on
  File "/oname=$PLUGINSDIR\onework-fixed-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"

  ${If} ${FileExists} "$OneWorkInstalledUninstaller"
    ClearErrors
    CopyFiles /SILENT "$OneWorkBundledUninstaller" "$OneWorkInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "copy-failed-retry"
      !insertmacro ONEWORK_STOP_APP_PROCESSES
      Sleep 1000

      ClearErrors
      CopyFiles /SILENT "$OneWorkBundledUninstaller" "$OneWorkInstalledUninstaller"
      ${If} ${Errors}
        ${If} ${FileExists} "$OneWorkBundledUninstaller"
          !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "copy-failed-using-bundled"
          !insertmacro ONEWORK_LOG_EVENT "event=uninstaller-repair phase=copy-failed-using-bundled"
        ${Else}
          !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair copy-failed-retry-bundled-missing" "${ONEWORK_MSG_UNINSTALLER_COPY_LOCKED_EN}" "${ONEWORK_MSG_UNINSTALLER_COPY_LOCKED_ZH}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
        ${EndIf}
      ${Else}
        !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "after-copy-retry"
      ${EndIf}
    ${Else}
      !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "after-copy"
    ${EndIf}
  ${Else}
    ClearErrors
    CopyFiles /SILENT "$OneWorkBundledUninstaller" "$OneWorkInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-failed" "${ONEWORK_MSG_UNINSTALLER_REBUILD_FAILED_EN}" "${ONEWORK_MSG_UNINSTALLER_REBUILD_FAILED_ZH}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    ${IfNot} ${FileExists} "$OneWorkInstalledUninstaller"
      !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-missing-after-copy" "${ONEWORK_MSG_UNINSTALLER_REBUILD_MISSING_EN}" "${ONEWORK_MSG_UNINSTALLER_REBUILD_MISSING_ZH}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${ONEWORK_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    !insertmacro ONEWORK_LOG_UNINSTALLER_REPAIR "rebuilt"
    !insertmacro ONEWORK_LOG_EVENT "event=uninstaller-repair phase=rebuilt"
  ${EndIf}
!macroend

!macro ONEWORK_HEAL_INSTALL_REGISTRY
  Var /GLOBAL OneWorkRegInstallLocation
  Var /GLOBAL OneWorkRegUninstallString
  Var /GLOBAL OneWorkRegInstallExe

  StrCpy $OneWorkRegistryInstallIsValid "0"

  ReadRegStr $OneWorkRegInstallLocation SHCTX "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $OneWorkRegUninstallString SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ${If} $OneWorkRegInstallLocation == ""
    !insertmacro ONEWORK_LOG_EVENT "event=registry-heal phase=missing-install-location uninstallString=$OneWorkRegUninstallString"
    !insertmacro ONEWORK_CLEAR_INSTALL_REGISTRY "missing-install-location"
  ${Else}
    StrCpy $OneWorkRegInstallExe "$OneWorkRegInstallLocation\${ONEWORK_APP_EXECUTABLE_FILENAME}"
    ${If} ${FileExists} "$OneWorkRegInstallExe"
      StrCpy $INSTDIR "$OneWorkRegInstallLocation"
      StrCpy $OneWorkRegistryInstallIsValid "1"
      !insertmacro ONEWORK_LOG_EVENT "event=registry-heal phase=valid-install-location instDir=$INSTDIR uninstallString=$OneWorkRegUninstallString"
    ${Else}
      !insertmacro ONEWORK_LOG_EVENT "event=registry-heal phase=stale-install-location installLocation=$OneWorkRegInstallLocation uninstallString=$OneWorkRegUninstallString"
      !insertmacro ONEWORK_CLEAR_INSTALL_REGISTRY "stale-install-location"
    ${EndIf}
  ${EndIf}
!macroend

!macro ONEWORK_LOG_UNINSTALL_RESULT _ROOT_KEY _HAD_ERRORS
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstall-result'; root = '${_ROOT_KEY}'; launchErrors = '${_HAD_ERRORS}'; exitCode = '$R0' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $OneWorkUninstallLogResult
!macroend

!macro ONEWORK_HANDLE_UNINSTALL_RESULT _ROOT_KEY _LABEL_PREFIX
  ${If} ${Errors}
    StrCpy $OneWorkUninstallHadErrors "1"
  ${Else}
    StrCpy $OneWorkUninstallHadErrors "0"
  ${EndIf}

  !insertmacro ONEWORK_LOG_UNINSTALL_RESULT "${_ROOT_KEY}" "$OneWorkUninstallHadErrors"

  ${If} $OneWorkUninstallHadErrors == "1"
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    Return
  ${EndIf}

  ${If} $R0 != 0
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      !insertmacro ONEWORK_READ_LAST_INNER_FAILURE
      ${If} $OneWorkLockerList != ""
        StrCpy $OneWorkInnerFailureSummary "- Failure: previous uninstaller failed with exit code $R0$\r$\n- File or folder: $INSTDIR$\r$\n- Blocking process: $OneWorkLockerList"
      ${EndIf}
      !insertmacro ONEWORK_LOG_EVENT "event=old-uninstaller-failed action=report exitCode=$R0 lockers=$OneWorkLockerList uninstallerDetail=$OneWorkInnerFailureSummary"
      ${If} $OneWorkInnerRootCode != ""
        !insertmacro ONEWORK_FAIL_REPORTABLE_ROOTED_BILINGUAL_DIAGNOSTICS "$OneWorkInnerRootCode" ${ONEWORK_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$OneWorkLockerList uninstallerDetail=$OneWorkInnerFailureSummary" "${ONEWORK_MSG_OLD_UNINSTALL_FAILED_EN}" "${ONEWORK_MSG_OLD_UNINSTALL_FAILED_ZH}" "${ONEWORK_MSG_OLD_UNINSTALL_ACTION_EN}" "${ONEWORK_MSG_OLD_UNINSTALL_ACTION_ZH}" "$OneWorkInnerFailureSummary" "$OneWorkInnerFailureSummary"
      ${Else}
        !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${ONEWORK_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$OneWorkLockerList uninstallerDetail=$OneWorkInnerFailureSummary" "${ONEWORK_MSG_OLD_UNINSTALL_FAILED_EN}" "${ONEWORK_MSG_OLD_UNINSTALL_FAILED_ZH}" "${ONEWORK_MSG_OLD_UNINSTALL_ACTION_EN}" "${ONEWORK_MSG_OLD_UNINSTALL_ACTION_ZH}" "$OneWorkInnerFailureSummary" "$OneWorkInnerFailureSummary"
      ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro ONEWORK_HEAL_INSTALL_REGISTRY
  ${If} $OneWorkRegistryInstallIsValid == "1"
    !insertmacro ONEWORK_REPAIR_INSTALLED_UNINSTALLER
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro ONEWORK_HANDLE_UNINSTALL_RESULT "SHELL_CONTEXT" "shctx"
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro ONEWORK_HANDLE_UNINSTALL_RESULT "HKEY_CURRENT_USER" "hkcu"
!macroend

!endif
