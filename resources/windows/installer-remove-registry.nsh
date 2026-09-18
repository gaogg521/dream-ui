!ifndef ONEWORK_INSTALLER_REMOVE_REGISTRY_NSH
!define ONEWORK_INSTALLER_REMOVE_REGISTRY_NSH

!macro ONEWORK_CLEAR_INSTALL_REGISTRY _REASON
  DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHCTX "${INSTALL_REGISTRY_KEY}"
  !insertmacro ONEWORK_LOG_EVENT "event=registry-clear reason=${_REASON} uninstallKey=${UNINSTALL_REGISTRY_KEY} installKey=${INSTALL_REGISTRY_KEY}"
!macroend

!macro ONEWORK_LOG_ATOMIC_REMOVE_FAILURE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$failed = '$OneWorkAtomicFailedPath'; \
    $$instDir = '$INSTDIR'; \
    $$oldInstallDir = '$OneWorkAtomicStagingDir'; \
    $$relative = $$failed; \
    if ($$failed.StartsWith($$instDir, [System.StringComparison]::CurrentCultureIgnoreCase)) { $$relative = $$failed.Substring($$instDir.Length).TrimStart('\') }; \
    $$tempCandidate = if ($$relative -and $$relative -ne $$failed) { Join-Path $$oldInstallDir $$relative } else { '' }; \
    $$kind = if ($$tempCandidate.Length -ge 260) { 'likely-long-path' } else { 'unknown' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-atomic-failed'; kind = $$kind; pathLength = $$failed.Length; tempCandidateLength = $$tempCandidate.Length; atomicFailedPath = $$failed; tempCandidate = $$tempCandidate }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $9
  Pop $9
!macroend

!macro ONEWORK_LOG_REMOVE_FAILURE_JSON _PHASE _FATAL _FAILED_PATH _EXTRA_FIELDS
  !insertmacro ONEWORK_LOG_JSON_EVENT "failure" "$$lockerText = '$OneWorkLockerList'; $$processes = @(); if ($$lockerText -and $$lockerText -notlike 'Windows did not identify*' -and $$lockerText -ne 'unknown process') { $$processes = @($$lockerText -split ',\s*' | Where-Object { $$_ } | ForEach-Object { if ($$_ -match '^(.*)\(([0-9]+)\)$$') { [ordered]@{ name = $$Matches[1]; pid = [int]$$Matches[2] } } else { [ordered]@{ name = $$_; pid = $$null } } }) }; $$payload.code = '${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED}'; $$payload.phase = '${_PHASE}'; $$payload.failedPath = '${_FAILED_PATH}'; $$payload.blockingProcesses = @($$processes); if ($$lockerText -like 'One Work installer(*)') { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$processes.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' } else { $$payload.fallbackReason = ''; $$payload.message = '' }; $$payload.fatal = ('${_FATAL}' -eq '1'); ${_EXTRA_FIELDS}"
!macroend

!macro ONEWORK_REMOVE_INSTALL_DIR
  StrCpy $OneWorkRemoveResidueCount "0"
  ${If} $OneWorkRemoveResidueRoot == ""
    StrCpy $OneWorkRemoveResidueRoot "$INSTDIR"
  ${EndIf}
  StrCpy $OneWorkRemoveFirstFailedPath ""
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'Continue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$path = [System.IO.Path]::GetFullPath('$OneWorkRemoveResidueRoot'); \
    $$firstFailedFile = '$PLUGINSDIR\aionui-remove-first-failed.txt'; \
    Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value ''; \
    function Write-InstallerLog($$message) { $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-log'; message = $$message }; if ($$message -match '(^|\s)event=([^\s]+)') { $$payload.event = $$Matches[2] }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) } \
    function Convert-LongPath($$itemPath) { if ($$itemPath.StartsWith('\\')) { return '\\?\UNC\' + $$itemPath.TrimStart('\') } return '\\?\' + $$itemPath } \
    function Remove-WithRetries($$item, $$isDir) { \
      $$delays = @(200,500,1000); \
      for ($$i = 0; $$i -lt $$delays.Count; $$i++) { \
        try { \
          if ($$isDir) { [System.IO.Directory]::Delete((Convert-LongPath $$item), $$false) } else { [System.IO.File]::Delete((Convert-LongPath $$item)) } \
          return $$true \
        } catch { \
          if ($$i -lt $$delays.Count - 1) { Start-Sleep -Milliseconds $$delays[$$i] } else { Write-InstallerLog ('event=remove-resilient-leftover path=' + $$item + ' attempts=3 error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); return $$false } \
        } \
      } \
      return $$false \
    } \
    try { \
      if (-not (Test-Path -LiteralPath $$path)) { Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); exit 0 } \
      $$failed = New-Object System.Collections.Generic.List[string]; \
      foreach ($$file in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$file.FullName $$false)) { $$failed.Add($$file.FullName) } } \
      foreach ($$dir in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$dir.FullName $$true)) { $$failed.Add($$dir.FullName) } } \
      if (-not (Remove-WithRetries $$path $$true)) { $$failed.Add($$path) } \
      Write-InstallerLog ('event=remove-resilient-summary failedCount=' + $$failed.Count + ' root=' + $$path); \
      if ($$failed.Count -gt 0) { Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value $$failed[0]; exit $$failed.Count } \
      Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); \
      exit 0 \
    } catch { \
      Write-InstallerLog ('remove-longpath result=1 instDir=' + $$path + ' error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); \
      exit 1 \
    } \
  }"`
  Pop $OneWorkRemoveDirResult

  ClearErrors
  SetDetailsPrint none
  FileOpen $OneWorkRemoveFirstFailedFile "$PLUGINSDIR\aionui-remove-first-failed.txt" r
  ${IfNot} ${Errors}
    FileRead $OneWorkRemoveFirstFailedFile $OneWorkRemoveFirstFailedPath
    FileClose $OneWorkRemoveFirstFailedFile
  ${EndIf}
  SetDetailsPrint lastused

  ${If} $OneWorkRemoveDirResult == "error"
    !insertmacro ONEWORK_LOG_EVENT "event=remove-longpath fallback=RMDir reason=no-powershell root=$INSTDIR"
    RMDir /r "$OneWorkRemoveResidueRoot"
    ${If} ${FileExists} "$OneWorkRemoveResidueRoot\*.*"
      StrCpy $OneWorkRemoveDirResult "1"
    ${Else}
      StrCpy $OneWorkRemoveDirResult "0"
    ${EndIf}
  ${EndIf}

  ${If} $OneWorkRemoveDirResult != 0
    StrCpy $OneWorkRemoveResidueCount $OneWorkRemoveDirResult
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro ONEWORK_LOG_EVENT "remove-start instDir=$INSTDIR"
  Var /GLOBAL OneWorkRemoveDirResult
  Var /GLOBAL OneWorkAtomicFailedPath
  Var /GLOBAL OneWorkAtomicRemoveSucceeded
  Var /GLOBAL OneWorkAtomicStagingDir
  Var /GLOBAL OneWorkRemoveResidueCount
  Var /GLOBAL OneWorkRemoveResidueRoot
  Var /GLOBAL OneWorkRemoveFirstFailedPath
  Var /GLOBAL OneWorkRemoveFirstFailedFile
  StrCpy $OneWorkAtomicFailedPath ""
  StrCpy $OneWorkAtomicRemoveSucceeded "0"
  StrCpy $OneWorkAtomicStagingDir ""
  StrCpy $OneWorkRemoveResidueCount "0"
  StrCpy $OneWorkRemoveResidueRoot "$INSTDIR"
  StrCpy $OneWorkRemoveFirstFailedPath ""

  SetOutPath $TEMP
  StrCpy $OneWorkCurrentOutDir "$TEMP"

  ${if} ${isUpdated}
    StrCpy $OneWorkAtomicStagingDir "$INSTDIR.__old"
    ${If} ${FileExists} "$OneWorkAtomicStagingDir\*.*"
      StrCpy $OneWorkRemoveResidueRoot "$OneWorkAtomicStagingDir"
      !insertmacro ONEWORK_LOG_EVENT "remove-stale-staging start root=$OneWorkRemoveResidueRoot"
      !insertmacro ONEWORK_REMOVE_INSTALL_DIR
      StrCpy $OneWorkRemoveResidueRoot "$INSTDIR"
    ${EndIf}

    aionui_retry_atomic_rename:
      ClearErrors
      Rename "$INSTDIR" "$OneWorkAtomicStagingDir"
    ${if} ${Errors}
      DetailPrint "Atomic update cleanup failed before replacing previous installation: $INSTDIR"
      StrCpy $OneWorkAtomicFailedPath "$INSTDIR"
      !insertmacro ONEWORK_LOG_ATOMIC_REMOVE_FAILURE
      !insertmacro ONEWORK_CAPTURE_FAILED_PATH_LOCKERS "$OneWorkAtomicFailedPath"
      ${IfNot} ${Silent}
        !insertmacro ONEWORK_PROMPT_FAILED_PATH_LOCKERS "$OneWorkAtomicFailedPath" "atomic-failed" aionui_retry_atomic_rename aionui_cancel_atomic_rename aionui_continue_atomic_failed
        aionui_cancel_atomic_rename:
      ${EndIf}
      aionui_continue_atomic_failed:
      !insertmacro ONEWORK_LOG_REMOVE_FAILURE_JSON "atomic-failed" "1" "$OneWorkAtomicFailedPath" "$$payload.atomicFailedPath = '$OneWorkAtomicFailedPath'"
      !insertmacro ONEWORK_LOG_EVENT "code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 degraded=none firstFailed=$OneWorkAtomicFailedPath atomicFailedPath=$OneWorkAtomicFailedPath"
      !insertmacro ONEWORK_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 firstFailed=$OneWorkAtomicFailedPath lockers=$OneWorkLockerList" "${ONEWORK_MSG_REPLACE_LOCKED_EN}" "${ONEWORK_MSG_REPLACE_LOCKED_ZH}" "${ONEWORK_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${ONEWORK_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
    ${else}
      !insertmacro ONEWORK_LOG_EVENT "remove-atomic result=0 staging=$OneWorkAtomicStagingDir"
      StrCpy $OneWorkAtomicRemoveSucceeded "1"
      StrCpy $OneWorkRemoveResidueRoot "$OneWorkAtomicStagingDir"
    ${endif}
  ${endif}

  aionui_retry_remove_install_dir:
    !insertmacro ONEWORK_REMOVE_INSTALL_DIR
  ${if} $OneWorkRemoveDirResult != 0
    !insertmacro ONEWORK_CAPTURE_FAILED_PATH_LOCKERS "$OneWorkRemoveFirstFailedPath"
    ${if} $OneWorkAtomicRemoveSucceeded == "1"
      ${IfNot} ${Silent}
        !insertmacro ONEWORK_PROMPT_FAILED_PATH_LOCKERS "$OneWorkRemoveFirstFailedPath" "residual-delete-failed" aionui_retry_remove_install_dir aionui_cancel_remove_after_rm aionui_continue_after_rm
        aionui_cancel_remove_after_rm:
          !insertmacro ONEWORK_LOG_REMOVE_FAILURE_JSON "residual-delete-failed" "1" "$OneWorkRemoveFirstFailedPath" "$$payload.residueRoot = '$OneWorkRemoveResidueRoot'; $$payload.failedCount = '$OneWorkRemoveResidueCount'; $$payload.removeDirResult = '$OneWorkRemoveDirResult'; $$payload.atomicSucceeded = ('$OneWorkAtomicRemoveSucceeded' -eq '1')"
          !insertmacro ONEWORK_LOG_EVENT "code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 residueRoot=$OneWorkRemoveResidueRoot failedCount=$OneWorkRemoveResidueCount firstFailed=$OneWorkRemoveFirstFailedPath removeDirResult=$OneWorkRemoveDirResult removeResidueCount=$OneWorkRemoveResidueCount atomicFailedPath=$OneWorkAtomicFailedPath atomicSucceeded=$OneWorkAtomicRemoveSucceeded"
          !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 firstFailed=$OneWorkRemoveFirstFailedPath lockers=$OneWorkLockerList" "${ONEWORK_MSG_PREVIOUS_FILE_OPEN_EN}" "${ONEWORK_MSG_PREVIOUS_FILE_OPEN_ZH}" "${ONEWORK_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${ONEWORK_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
      ${EndIf}
      aionui_continue_after_rm:
      DetailPrint `One Work previous installation had locked residual files; continuing after atomic cleanup succeeded: $INSTDIR`
      !insertmacro ONEWORK_LOG_EVENT "code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed degraded=continue fatal=0 residueRoot=$OneWorkRemoveResidueRoot failedCount=$OneWorkRemoveResidueCount firstFailed=$OneWorkRemoveFirstFailedPath removeDirResult=$OneWorkRemoveDirResult removeResidueCount=$OneWorkRemoveResidueCount atomicFailedPath=$OneWorkAtomicFailedPath atomicSucceeded=$OneWorkAtomicRemoveSucceeded"
    ${else}
      DetailPrint `Can't safely remove previous installation without atomic cleanup proof: $INSTDIR`
      ${IfNot} ${Silent}
        !insertmacro ONEWORK_PROMPT_FAILED_PATH_LOCKERS "$OneWorkRemoveFirstFailedPath" "residual-delete-failed-no-atomic-proof" aionui_retry_remove_install_dir aionui_cancel_remove_no_atomic aionui_continue_remove_no_atomic
        aionui_cancel_remove_no_atomic:
      ${EndIf}
      aionui_continue_remove_no_atomic:
      !insertmacro ONEWORK_LOG_REMOVE_FAILURE_JSON "residual-delete-failed-no-atomic-proof" "1" "$OneWorkRemoveFirstFailedPath" "$$payload.residueRoot = '$OneWorkRemoveResidueRoot'; $$payload.failedCount = '$OneWorkRemoveResidueCount'; $$payload.removeDirResult = '$OneWorkRemoveDirResult'; $$payload.atomicSucceeded = ('$OneWorkAtomicRemoveSucceeded' -eq '1')"
      !insertmacro ONEWORK_LOG_EVENT "code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof degraded=none fatal=1 residueRoot=$OneWorkRemoveResidueRoot failedCount=$OneWorkRemoveResidueCount firstFailed=$OneWorkRemoveFirstFailedPath removeDirResult=$OneWorkRemoveDirResult removeResidueCount=$OneWorkRemoveResidueCount atomicFailedPath=$OneWorkAtomicFailedPath atomicSucceeded=$OneWorkAtomicRemoveSucceeded"
      !insertmacro ONEWORK_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL ${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof fatal=1 firstFailed=$OneWorkRemoveFirstFailedPath removeDirResult=$OneWorkRemoveDirResult lockers=$OneWorkLockerList" "${ONEWORK_MSG_REMOVE_PREVIOUS_DIR_EN}" "${ONEWORK_MSG_REMOVE_PREVIOUS_DIR_ZH}" "${ONEWORK_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${ONEWORK_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}"
    ${endif}
  ${else}
    !insertmacro ONEWORK_LOG_EVENT "remove-final errors=0 instDir=$INSTDIR removeDirResult=$OneWorkRemoveDirResult removeResidueCount=$OneWorkRemoveResidueCount removeResidueRoot=$OneWorkRemoveResidueRoot atomicFailedPath=$OneWorkAtomicFailedPath atomicSucceeded=$OneWorkAtomicRemoveSucceeded"
  ${endif}
!macroend

!macro customUnInit
  !insertmacro ONEWORK_LOG_EVENT "uninit instDir=$INSTDIR"
!macroend

!macro customUnInstall
  !insertmacro ONEWORK_LOG_EVENT "uninstall-section start instDir=$INSTDIR"
!macroend

!endif
