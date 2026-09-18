!ifndef ONEWORK_INSTALLER_UPDATE_VERIFY_NSH
!define ONEWORK_INSTALLER_UPDATE_VERIFY_NSH

Var /GLOBAL OneWorkUninstallHadErrors
Var /GLOBAL OneWorkUninstallLogResult
Var /GLOBAL OneWorkVerifyResourceResult
Var /GLOBAL OneWorkUpdatedAppExitWaitResult
Var /GLOBAL OneWorkActiveMarkerExecResult
Var /GLOBAL OneWorkActiveMarkerResult

!define ONEWORK_ACTIVE_INSTALLER_MARKER "onework-installer-active.marker"

!macro ONEWORK_BRING_UPDATED_INSTALLER_TO_FRONT
  ${If} ${isUpdated}
    BringToFront
    !insertmacro ONEWORK_SLOG "event=updated-installer-foreground action=bring-to-front"
  ${EndIf}
!macroend

!macro ONEWORK_WAIT_FOR_UPDATED_APP_EXIT
  ${If} ${isUpdated}
    !insertmacro ONEWORK_SLOG "event=updated-app-exit-wait phase=start"
    StrCpy $OneWorkUpdatedAppExitWaitResult "0"

    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      $$deadline = (Get-Date).AddSeconds(10); \
      $$target = [System.IO.Path]::GetFullPath((Join-Path '$INSTDIR' '${ONEWORK_APP_EXECUTABLE_FILENAME}')); \
      do { \
        $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { \
          $$path = $$_.ExecutablePath; \
          if (-not $$path) { $$path = $$_.Path } \
          $$_.Name -ieq '${ONEWORK_APP_EXECUTABLE_FILENAME}' -and $$path -and \
          [string]::Equals([System.IO.Path]::GetFullPath($$path), $$target, [System.StringComparison]::CurrentCultureIgnoreCase) \
        }); \
        if ($$hits.Count -eq 0) { exit 0 }; \
        Start-Sleep -Milliseconds 500; \
      } while ((Get-Date) -lt $$deadline); \
      exit 1 \
    }"`
    Pop $OneWorkUpdatedAppExitWaitResult

    ${If} $OneWorkUpdatedAppExitWaitResult != 0
      !insertmacro ONEWORK_SLOG "event=updated-app-exit-wait phase=timeout action=stop"
      !insertmacro ONEWORK_STOP_APP_PROCESSES
    ${EndIf}

    !insertmacro ONEWORK_SLOG "event=updated-app-exit-wait phase=done result=$OneWorkUpdatedAppExitWaitResult"
  ${EndIf}
!macroend

!macro ONEWORK_RECORD_ACTIVE_INSTALLER_MARKER
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${ONEWORK_ACTIVE_INSTALLER_MARKER}'; \
    if (-not (Test-Path -LiteralPath $$marker)) { Write-Output 'missing'; exit 0 }; \
    $$item = Get-Item -LiteralPath $$marker; \
    if ($$item.LastWriteTime -lt (Get-Date).AddHours(-2)) { Write-Output 'stale'; exit 0 }; \
    Write-Output 'active' \
  }"`
  Pop $OneWorkActiveMarkerExecResult
  Pop $OneWorkActiveMarkerResult
  ${If} $OneWorkActiveMarkerResult == "active"
    !insertmacro ONEWORK_SLOG "event=installer-active-marker state=active"
  ${ElseIf} $OneWorkActiveMarkerResult == "stale"
    !insertmacro ONEWORK_SLOG "event=installer-active-marker state=stale"
  ${Else}
    !insertmacro ONEWORK_SLOG "event=installer-active-marker state=missing"
  ${EndIf}
!macroend

!macro ONEWORK_WRITE_ACTIVE_INSTALLER_MARKER
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${ONEWORK_ACTIVE_INSTALLER_MARKER}'; \
    Set-Content -LiteralPath $$marker -Encoding UTF8 -Value ('pid=' + $$PID + ';session=$OneWorkSessionId;started=' + (Get-Date -Format o)) \
  }"`
  Pop $OneWorkActiveMarkerResult
!macroend

!macro ONEWORK_CLEAR_ACTIVE_INSTALLER_MARKER
  !ifndef BUILD_UNINSTALLER
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      Remove-Item -LiteralPath (Join-Path $$env:TEMP '${ONEWORK_ACTIVE_INSTALLER_MARKER}') -Force \
    }"`
    Pop $OneWorkActiveMarkerResult
  !endif
!macroend

!macro ONEWORK_OVERRIDE_SINGLE_INSTANCE
!macroend

!macro ONEWORK_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
  !pragma warning disable 6030
  LangString appCannotBeClosed 1033 "${ONEWORK_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${ONEWORK_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${ONEWORK_MSG_APP_CANNOT_BE_CLOSED_EN}"
  LangString appCannotBeClosed 2052 "${ONEWORK_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${ONEWORK_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${ONEWORK_MSG_APP_CANNOT_BE_CLOSED_EN}"
  !pragma warning default 6030
!macroend

!macro ONEWORK_INSTALLER_CUSTOM_HEADER
  !insertmacro ONEWORK_OVERRIDE_SINGLE_INSTANCE
  !insertmacro ONEWORK_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
!macroend

!macro ONEWORK_RELEASE_INSTALL_DIR_OUTDIR
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  StrCpy $OneWorkCurrentOutDir "$PLUGINSDIR"
!macroend

; Resolve the machine's real native architecture (arm64 / x64 / x86) for diagnostics.
; Backed by IsWow64Process2 (via x64.nsh), so it reports the true hardware arch even when
; the installer runs under x86/x64 emulation. Replaces the old hardcoded "non-arm64" detail.
!macro ONEWORK_DETECT_NATIVE_ARCH _OUT
  ${If} ${IsNativeARM64}
    StrCpy ${_OUT} "arm64"
  ${ElseIf} ${RunningX64}
    StrCpy ${_OUT} "x64"
  ${Else}
    StrCpy ${_OUT} "x86"
  ${EndIf}
!macroend

!macro ONEWORK_INSTALLER_PREINIT
  !ifdef BUILD_UNINSTALLER
    StrCpy $OneWorkSessionId ""
    StrCpy $OneWorkIsUpdated "0"
    StrCpy $OneWorkSessionLogResult ""
    StrCpy $OneWorkSessionLogPath "$TEMP\${ONEWORK_FALLBACK_LOG}"
    StrCpy $OneWorkUninstallHadErrors "0"
    StrCpy $OneWorkUninstallLogResult ""
    StrCpy $OneWorkVerifyResourceResult ""
    StrCpy $OneWorkUpdatedAppExitWaitResult ""
    StrCpy $OneWorkActiveMarkerExecResult ""
    StrCpy $OneWorkActiveMarkerResult ""
    StrCpy $OneWorkStopResult ""
    StrCpy $OneWorkLockerListZh ""
    StrCpy $OneWorkLockerListEn ""
  !else
    !insertmacro ONEWORK_RELEASE_INSTALL_DIR_OUTDIR
    !insertmacro ONEWORK_SESSION_BEGIN
    !insertmacro ONEWORK_SLOG "event=installer-outdir-release outDir=$OneWorkCurrentOutDir instDir=$INSTDIR"
    ; Guard target/machine architecture as early as possible: this runs before customInit's
    ; registry heal/clear/repair, so a wrong-arch installer aborts without mutating an existing
    ; correct-arch install's registry or uninstaller state. (Sentry ELECTRON-3BX / code E1040)
    !insertmacro ONEWORK_ASSERT_TARGET_ARCH
    !insertmacro ONEWORK_BRING_UPDATED_INSTALLER_TO_FRONT
    !insertmacro ONEWORK_RECORD_ACTIVE_INSTALLER_MARKER
    !insertmacro ONEWORK_WRITE_ACTIVE_INSTALLER_MARKER
  !endif
!macroend

!macro ONEWORK_VERIFY_REQUIRED_FILE _PATH _LABEL
  ${IfNot} ${FileExists} "${_PATH}"
    !insertmacro ONEWORK_LOG_EVENT "verify-required-file missing label=${_LABEL} path=${_PATH}"
    !insertmacro ONEWORK_FAIL_UX \
      "${ONEWORK_E_CORE_APP_FILES_INCOMPLETE}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "${ONEWORK_MSG_VERIFY_REQUIRED_FILE_ZH} ${_LABEL}" \
      "${ONEWORK_MSG_VERIFY_REQUIRED_FILE_EN} ${_LABEL}" \
      "${ONEWORK_MSG_VERIFY_REQUIRED_FILE_ACTION_ZH}" \
      "${ONEWORK_MSG_VERIFY_REQUIRED_FILE_ACTION_EN}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}"
  ${Else}
    !insertmacro ONEWORK_LOG_EVENT "verify-required-file ok label=${_LABEL} path=${_PATH}"
  ${EndIf}
!macroend

!macro ONEWORK_VERIFY_CORE_APP_FILES
  !insertmacro ONEWORK_LOG_EVENT "verify-install start instDir=$INSTDIR"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\${ONEWORK_APP_EXECUTABLE_FILENAME}" "${ONEWORK_APP_EXECUTABLE_FILENAME}"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\ffmpeg.dll" "ffmpeg.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\libEGL.dll" "libEGL.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\libGLESv2.dll" "libGLESv2.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\d3dcompiler_47.dll" "d3dcompiler_47.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\dxcompiler.dll" "dxcompiler.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\dxil.dll" "dxil.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\vk_swiftshader.dll" "vk_swiftshader.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\vulkan-1.dll" "vulkan-1.dll"
  !insertmacro ONEWORK_VERIFY_REQUIRED_FILE "$INSTDIR\resources\app.asar" "resources\app.asar"
!macroend

!macro ONEWORK_VERIFY_BUNDLED_AIONCORE_RESOURCES _RUNTIME_KEY
  InitPluginsDir
  File "/oname=$PLUGINSDIR\verify-bundled-dreamcore-install.ps1" "${PROJECT_DIR}\resources\windows\support\verify-bundled-dreamcore-install.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-bundled-dreamcore-install.ps1" -InstallDir "$INSTDIR" -RuntimeKey "${_RUNTIME_KEY}" -LogPath "$OneWorkSessionLogPath"`
  Pop $OneWorkVerifyResourceResult

  ${If} $OneWorkVerifyResourceResult != 0
    !insertmacro ONEWORK_FAIL_UX \
      "${ONEWORK_E_BUNDLED_AIONCORE_INCOMPLETE}" \
      "event=session-end result=fail code=${ONEWORK_E_BUNDLED_AIONCORE_INCOMPLETE} detail=bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$OneWorkVerifyResourceResult" \
      "${ONEWORK_MSG_BUNDLED_AIONCORE_INCOMPLETE_ZH}" \
      "${ONEWORK_MSG_BUNDLED_AIONCORE_INCOMPLETE_EN}" \
      "${ONEWORK_MSG_BUNDLED_AIONCORE_INCOMPLETE_ACTION_ZH}" \
      "${ONEWORK_MSG_BUNDLED_AIONCORE_INCOMPLETE_ACTION_EN}" \
      "bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$OneWorkVerifyResourceResult instDir=$INSTDIR" \
      "bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$OneWorkVerifyResourceResult instDir=$INSTDIR"
  ${EndIf}
!macroend

; Remove an install directory that nothing else can.
;
; `executableName` went 1onecode -> One Work -> onework, and NSIS derives the
; install directory from it, so each rename installed a fresh copy beside the
; last. Measured on a real machine mid-upgrade: all three present under
; Programs at 2.28 GB each.
;
; Only "One Work" is swept. On that machine it had no uninstall entry of any
; kind — nothing in HKCU or HKLM pointed at it — so nothing else will ever
; remove it. "1onecode" still has a working entry under an older appId;
; deleting its files would turn a working Add/Remove Programs entry into one
; that fails when clicked, which is worse than leaving it.
;
; Runs from customInstall, after the new version's files are verified in place,
; so $INSTDIR is real before anything is deleted.
; One orphaned install directory. `_ID` exists only to keep the labels unique
; across insertions — NSIS labels are global to the function.
;
; Both conditions are required. Being on the list is not on its own a reason
; to RMDir /r a directory on someone's disk: `app.asar` is what makes it one
; of ours rather than a name collision, and the $INSTDIR guard is what stops
; a future rename from making this delete the install it just wrote.
;
; Deliberately does NOT touch the registry. Every build this fork has ever
; shipped uses the SAME appId (com.huanle.oneone.ai, frozen since the first
; commit, and identical in the 1oneUI snapshot), and neither config sets
; `guid`, so there has only ever been ONE uninstall key — whichever install
; ran last owns it. A key left naming a directory removed here is already
; handled by ONEWORK_HEAL_INSTALL_REGISTRY, which clears it when
; <InstallLocation>\onework.exe is missing. Clearing it a second time here
; would be the same rule in two places, disagreeing on ordering.
!macro DREAM_REMOVE_ORPHANED_INSTALL_AT _ID _PATH
  StrCpy $R7 "${_PATH}"
  StrCmp $R7 "$INSTDIR" dreamOrphanDone_${_ID}
  IfFileExists "$R7\resources\app.asar" 0 dreamOrphanDone_${_ID}
    !insertmacro ONEWORK_LOG_EVENT "orphaned-install-remove path=$R7"
    RMDir /r "$R7"
  dreamOrphanDone_${_ID}:
!macroend

; The install directories older builds of THIS app wrote to, none of which a
; new install replaces or Add/Remove Programs can reach:
;
;   Programs\One Work   executableName fell back to productName
;   Programs\1onecode   executableName in the 1oneUI snapshot
;
; Windows treats all three names as unrelated programs, so without this the
; user ends up with two or three identical icons opening different versions.
; User data is never in these directories — it lives in %APPDATA%\One Work,
; pinned by app.setName(PROD_USERDATA_APP_NAME) and untouched by any of this.
!macro DREAM_REMOVE_ORPHANED_INSTALLS
  Push $R7
  !insertmacro DREAM_REMOVE_ORPHANED_INSTALL_AT "spaced" "$LOCALAPPDATA\Programs\One Work"
  !insertmacro DREAM_REMOVE_ORPHANED_INSTALL_AT "onecode" "$LOCALAPPDATA\Programs\1onecode"
  Pop $R7
!macroend

!macro customInstall
  !insertmacro ONEWORK_VERIFY_CORE_APP_FILES
  !insertmacro ONEWORK_VERIFY_BUNDLED_AIONCORE_RESOURCES "${ONEWORK_RUNTIME_KEY}"
  !insertmacro ONEWORK_LOG_EVENT "verify-install ok instDir=$INSTDIR"
  !insertmacro DREAM_REMOVE_ORPHANED_INSTALLS
  !insertmacro ONEWORK_CLEAR_ACTIVE_INSTALLER_MARKER
  !insertmacro ONEWORK_SESSION_SUCCESS
!macroend

!endif
