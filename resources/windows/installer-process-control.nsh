!ifndef ONEWORK_INSTALLER_PROCESS_CONTROL_NSH
!define ONEWORK_INSTALLER_PROCESS_CONTROL_NSH

Var /GLOBAL OneWorkStopResult
Var /GLOBAL OneWorkLockerResult
Var /GLOBAL OneWorkLockerList
Var /GLOBAL OneWorkLockerListZh
Var /GLOBAL OneWorkLockerListEn
Var /GLOBAL OneWorkLockerListFile
Var /GLOBAL OneWorkLockerIdentified
Var /GLOBAL OneWorkCurrentOutDir

!macro ONEWORK_FIND_APP_PROCESS _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-OneWorkOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { Test-OneWorkOwnedProcess $$_ }); \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find'; ownedPrefix = $$ownedPrefix; installerPid = $$installerPid; hits = $$hits.Count; owned = ($$hits.Count -gt 0) }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    if ($$hits.Count -gt 0) { $$hitPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find-hits'; processes = @($$hits | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,Path,CommandLine) }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$hitPayload | ConvertTo-Json -Compress -Depth 10); exit 0 } \
    exit 1 \
  }"`
  Pop ${_RETURN}
!macroend

!macro ONEWORK_STOP_APP_PROCESSES
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-OneWorkOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$all = @(Get-CimInstance -ClassName Win32_Process); \
    $$owned = @($$all | Where-Object { Test-OneWorkOwnedProcess $$_ }); \
    $$ids = @($$owned | ForEach-Object { [int]$$_.ProcessId }); \
    $$frontier = @($$ids); \
    while ($$frontier.Count -gt 0) { \
      $$children = @($$all | Where-Object { $$frontier -contains [int]$$_.ParentProcessId -and [int]$$_.ProcessId -ne [int]$$installerPid } | Where-Object { Test-OneWorkOwnedProcess $$_ }); \
      $$childIds = @($$children | ForEach-Object { [int]$$_.ProcessId }); \
      $$ids = @($$ids + $$childIds | Select-Object -Unique); \
      $$frontier = $$childIds; \
    } \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'start' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    foreach ($$id in ($$ids | Sort-Object -Descending)) { Stop-Process -Id $$id -Force -ErrorAction SilentlyContinue } \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'done' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    exit 0 \
  }"`
  Pop $OneWorkStopResult
!macroend

; Pre-rebrand bundled-backend path. An in-place upgrade from a legacy build can
; still have that copy on disk holding a file lock, so the Restart Manager query
; has to register it alongside the current one.
!define ONEWORK_LEGACY_BUNDLED_BACKEND "resources\bundled-aioncore\win32-x64\aioncore.exe"

!macro ONEWORK_QUERY_LOCKERS_INLINE_LEGACY _TARGET_PATH _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$targetPath = '${_TARGET_PATH}'; \
    $$currentOutDir = '$OneWorkCurrentOutDir'; \
    $$lockerListPath = '$PLUGINSDIR\onework-rm-lockers.txt'; \
    [System.IO.File]::WriteAllText($$lockerListPath, '', (New-Object System.Text.UTF8Encoding $$false)); \
    try { \
    function Test-OneWorkSamePath($$left, $$right) { \
      if ([string]::IsNullOrWhiteSpace($$left) -or [string]::IsNullOrWhiteSpace($$right)) { return $$false }; \
      try { \
        $$leftFull = [System.IO.Path]::GetFullPath($$left).TrimEnd('\'); \
        $$rightFull = [System.IO.Path]::GetFullPath($$right).TrimEnd('\'); \
        return [string]::Equals($$leftFull, $$rightFull, [System.StringComparison]::CurrentCultureIgnoreCase) \
      } catch { return $$false } \
    } \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = if ($$psProc) { [int]$$psProc.ParentProcessId } else { 0 }; \
    $$installerSelfLock = (Test-OneWorkSamePath $$currentOutDir $$targetPath) -or (Test-OneWorkSamePath $$currentOutDir $$instDir); \
      $$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('dXNpbmcgU3lzdGVtOyB1c2luZyBTeXN0ZW0uVGV4dDsgdXNpbmcgU3lzdGVtLlJ1bnRpbWUuSW50ZXJvcFNlcnZpY2VzOyBuYW1lc3BhY2UgT25lV29yay5SZXN0YXJ0TWFuYWdlciB7IHB1YmxpYyBlbnVtIFJNX0FQUF9UWVBFIHsgUm1Vbmtub3duQXBwID0gMCwgUm1NYWluV2luZG93ID0gMSwgUm1PdGhlcldpbmRvdyA9IDIsIFJtU2VydmljZSA9IDMsIFJtRXhwbG9yZXIgPSA0LCBSbUNvbnNvbGUgPSA1LCBSbUNyaXRpY2FsID0gMTAwMCB9IFtTdHJ1Y3RMYXlvdXQoTGF5b3V0S2luZC5TZXF1ZW50aWFsKV0gcHVibGljIHN0cnVjdCBSTV9VTklRVUVfUFJPQ0VTUyB7IHB1YmxpYyBpbnQgZHdQcm9jZXNzSWQ7IHB1YmxpYyBTeXN0ZW0uUnVudGltZS5JbnRlcm9wU2VydmljZXMuQ29tVHlwZXMuRklMRVRJTUUgUHJvY2Vzc1N0YXJ0VGltZTsgfSBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCwgQ2hhclNldCA9IENoYXJTZXQuVW5pY29kZSldIHB1YmxpYyBzdHJ1Y3QgUk1fUFJPQ0VTU19JTkZPIHsgcHVibGljIFJNX1VOSVFVRV9QUk9DRVNTIFByb2Nlc3M7IFtNYXJzaGFsQXMoVW5tYW5hZ2VkVHlwZS5CeVZhbFRTdHIsIFNpemVDb25zdCA9IDI1NildIHB1YmxpYyBzdHJpbmcgc3RyQXBwTmFtZTsgW01hcnNoYWxBcyhVbm1hbmFnZWRUeXBlLkJ5VmFsVFN0ciwgU2l6ZUNvbnN0ID0gNjQpXSBwdWJsaWMgc3RyaW5nIHN0clNlcnZpY2VTaG9ydE5hbWU7IHB1YmxpYyBSTV9BUFBfVFlQRSBBcHBsaWNhdGlvblR5cGU7IHB1YmxpYyB1aW50IEFwcFN0YXR1czsgcHVibGljIHVpbnQgVFNTZXNzaW9uSWQ7IFtNYXJzaGFsQXMoVW5tYW5hZ2VkVHlwZS5Cb29sKV0gcHVibGljIGJvb2wgYlJlc3RhcnRhYmxlOyB9IHB1YmxpYyBzdGF0aWMgY2xhc3MgTmF0aXZlIHsgW0RsbEltcG9ydCgicnN0cnRtZ3IuZGxsIiwgQ2hhclNldD1DaGFyU2V0LlVuaWNvZGUpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBpbnQgUm1TdGFydFNlc3Npb24ob3V0IHVpbnQgcFNlc3Npb25IYW5kbGUsIGludCBkd1Nlc3Npb25GbGFncywgU3RyaW5nQnVpbGRlciBzdHJTZXNzaW9uS2V5KTsgW0RsbEltcG9ydCgicnN0cnRtZ3IuZGxsIiwgQ2hhclNldD1DaGFyU2V0LlVuaWNvZGUpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBpbnQgUm1SZWdpc3RlclJlc291cmNlcyh1aW50IGR3U2Vzc2lvbkhhbmRsZSwgVUludDMyIG5GaWxlcywgc3RyaW5nW10gcmdzRmlsZW5hbWVzLCBVSW50MzIgbkFwcGxpY2F0aW9ucywgSW50UHRyIHJnQXBwbGljYXRpb25zLCBVSW50MzIgblNlcnZpY2VzLCBzdHJpbmdbXSByZ3NTZXJ2aWNlTmFtZXMpOyBbRGxsSW1wb3J0KCJyc3RydG1nci5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gaW50IFJtR2V0TGlzdCh1aW50IGR3U2Vzc2lvbkhhbmRsZSwgb3V0IHVpbnQgcG5Qcm9jSW5mb05lZWRlZCwgcmVmIHVpbnQgcG5Qcm9jSW5mbywgW0luLCBPdXRdIFJNX1BST0NFU1NfSU5GT1tdIHJnQWZmZWN0ZWRBcHBzLCByZWYgdWludCBscGR3UmVib290UmVhc29ucyk7IFtEbGxJbXBvcnQoInJzdHJ0bWdyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBpbnQgUm1FbmRTZXNzaW9uKHVpbnQgcFNlc3Npb25IYW5kbGUpOyB9IH0=')); \
      Add-Type -TypeDefinition $$source -ErrorAction Stop; \
      $$session = [uint32]0; $$key = New-Object System.Text.StringBuilder 64; \
      $$result = [OneWork.RestartManager.Native]::RmStartSession([ref]$$session, 0, $$key); \
      if ($$result -ne 0) { throw \"RmStartSession=$$result\" } \
      try { \
        $$ERROR_MORE_DATA = 234; \
        $$ERROR_ACCESS_DENIED = 5; \
        $$resources = @(); \
        if ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Leaf)) { \
          $$resources = @([System.IO.Path]::GetFullPath($$targetPath)); \
        } elseif ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Container)) { \
          $$root = [System.IO.Path]::GetFullPath($$targetPath); \
          $$topLevel = @(Get-ChildItem -LiteralPath $$root -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $$_.FullName }); \
          $$knownRelative = @('${ONEWORK_APP_EXECUTABLE_FILENAME}', '${UNINSTALL_FILENAME}', 'resources\app.asar', 'resources\app-update.yml', 'resources\bundled-dreamcore\win32-${ONEWORK_TARGET_ARCH}\dreamcore.exe', '${ONEWORK_LEGACY_BUNDLED_BACKEND}'); \
          $$known = @($$knownRelative | ForEach-Object { Join-Path $$root $$_ } | Where-Object { Test-Path -LiteralPath $$_ -PathType Leaf }); \
          $$resources = @($$topLevel + $$known | Where-Object { $$_ -and $$_.Trim().Length -gt 0 } | Select-Object -Unique | Select-Object -First 512); \
        } \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-query-start'; target = $$targetPath; resources = $$resources.Count; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
        if ($$resources.Count -eq 0) { \
          if ($$installerSelfLock -and $$installerPid -gt 0) { \
            $$lockerText = 'One Work installer(' + $$installerPid + ')'; \
            [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
            $$selfLockers = @([pscustomobject]@{ name = 'One Work installer'; pid = [int]$$installerPid }); \
            $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 1; blockingProcesses = @($$selfLockers); fallbackReason = 'installer-self-lock'; message = 'The installer process is using the install directory as its current output directory.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$true }; \
            Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
            exit 0 \
          }; \
          $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 0; blockingProcesses = @(); fallbackReason = 'restart-manager-no-resources'; message = 'Restart Manager had no existing files to query for this path.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
          exit 1 \
        } \
        for ($$i = 0; $$i -lt $$resources.Count; $$i += 256) { \
          $$end = [Math]::Min($$i + 255, $$resources.Count - 1); \
          $$chunk = [string[]]$$resources[$$i..$$end]; \
          $$result = [OneWork.RestartManager.Native]::RmRegisterResources($$session, [uint32]$$chunk.Count, $$chunk, 0, [IntPtr]::Zero, 0, $$null); \
          if ($$result -ne 0) { throw \"RmRegisterResources=$$result\" } \
        } \
        $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
        for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
          if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
          $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
          $$result = [OneWork.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$null, [ref]$$reasons); \
          if ($$result -ne $$ERROR_ACCESS_DENIED) { break } \
        } \
        if ($$result -ne 0 -and $$result -ne 234) { throw \"RmGetList=$$result\" } \
        $$lockers = @(); \
        if ($$result -eq $$ERROR_MORE_DATA -or $$needed -gt 0) { \
          for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
            if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
            $$count = $$needed; \
            $$apps = New-Object 'OneWork.RestartManager.RM_PROCESS_INFO[]' $$count; \
            $$result = [OneWork.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$apps, [ref]$$reasons); \
            if ($$result -ne $$ERROR_ACCESS_DENIED -and $$result -ne $$ERROR_MORE_DATA) { break } \
          } \
          if ($$result -ne 0) { throw \"RmGetList=$$result\" } \
          $$lockers = @($$apps | Select-Object -First $$count | Where-Object { $$_.Process.dwProcessId -gt 0 } | ForEach-Object { \
            $$name = $$_.strAppName; \
            if (-not $$name) { $$proc = Get-Process -Id $$_.Process.dwProcessId -ErrorAction SilentlyContinue; if ($$proc) { $$name = $$proc.ProcessName } } \
            if (-not $$name) { $$name = 'unknown' } \
            [pscustomobject]@{ name = $$name; pid = [int]$$_.Process.dwProcessId } \
          }); \
        } \
        if ($$lockers.Count -eq 0 -and $$installerSelfLock -and $$installerPid -gt 0) { $$lockers = @([pscustomobject]@{ name = 'One Work installer'; pid = [int]$$installerPid }) }; \
        $$lockerText = @($$lockers | ForEach-Object { $$_.name + '(' + $$_.pid + ')' }) -join ', '; \
        [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = $$resources.Count; count = $$needed; blockingProcesses = @($$lockers); fallbackReason = ''; message = ''; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        if ($$installerSelfLock -and $$lockers.Count -gt 0) { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$lockers.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
        if ($$lockers.Count -gt 0) { exit 0 } else { exit 1 } \
      } finally { [void][OneWork.RestartManager.Native]::RmEndSession($$session) } \
    } catch { \
      $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-error'; target = $$targetPath; error = $$_.Exception.Message }; \
      Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
      exit 1 \
    } \
  }"`
  Pop ${_RETURN}
!macroend

!macro ONEWORK_QUERY_LOCKERS _TARGET_PATH _RETURN
  InitPluginsDir
  File /oname=$PLUGINSDIR\onework-query-lockers.ps1 "${PROJECT_DIR}\resources\windows\support\query-lockers.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\onework-query-lockers.ps1" -LogPath "$OneWorkSessionLogPath" -InstDir "$INSTDIR" -TargetPath "${_TARGET_PATH}" -LockerListPath "$PLUGINSDIR\onework-rm-lockers.txt" -Session "$OneWorkSessionId" -Version "${VERSION}" -Arch "${ONEWORK_TARGET_ARCH}" -Updated "$OneWorkIsUpdated" -CurrentOutDir "$OneWorkCurrentOutDir"`
  Pop ${_RETURN}
!macroend

!macro ONEWORK_CAPTURE_FAILED_PATH_LOCKERS _FAILED_PATH
  !insertmacro ONEWORK_QUERY_LOCKERS "${_FAILED_PATH}" $OneWorkLockerResult
  StrCpy $OneWorkLockerList ""
  ClearErrors
  SetDetailsPrint none
  FileOpen $OneWorkLockerListFile "$PLUGINSDIR\onework-rm-lockers.txt" r
  ${IfNot} ${Errors}
    FileRead $OneWorkLockerListFile $OneWorkLockerList
    FileClose $OneWorkLockerListFile
  ${EndIf}
  SetDetailsPrint lastused
  ; Whether Restart Manager actually named a process. The dialog below reads
  ; this rather than the list string: the "unknown process" placeholder is not
  ; something a user can close, and telling them to close it is the difference
  ; between a useful message and a dead end.
  StrCpy $OneWorkLockerIdentified "1"
  ${If} $OneWorkLockerList == ""
    StrCpy $OneWorkLockerIdentified "0"
    ${If} $OneWorkLockerResult == 0
      StrCpy $OneWorkLockerList "${ONEWORK_MSG_UNKNOWN_PROCESS_EN}"
      StrCpy $OneWorkLockerListZh "${ONEWORK_MSG_UNKNOWN_PROCESS_ZH}"
      StrCpy $OneWorkLockerListEn "${ONEWORK_MSG_UNKNOWN_PROCESS_EN}"
    ${Else}
      StrCpy $OneWorkLockerList "${ONEWORK_MSG_LOCKER_UNKNOWN_EN}"
      StrCpy $OneWorkLockerListZh "${ONEWORK_MSG_LOCKER_UNKNOWN_ZH}"
      StrCpy $OneWorkLockerListEn "${ONEWORK_MSG_LOCKER_UNKNOWN_EN}"
    ${EndIf}
  ${Else}
    StrCpy $OneWorkLockerListZh "$OneWorkLockerList"
    StrCpy $OneWorkLockerListEn "$OneWorkLockerList"
  ${EndIf}
!macroend

!macro ONEWORK_PROMPT_FAILED_PATH_LOCKERS _FAILED_PATH _PHASE _RETRY_LABEL _CANCEL_LABEL _CONTINUE_LABEL
  !insertmacro ONEWORK_CAPTURE_FAILED_PATH_LOCKERS "${_FAILED_PATH}"
  ${If} $OneWorkLockerResult == 0
    ${IfNot} ${Silent}
      ; Two dialogs, not one with a placeholder. When Restart Manager names a
      ; process the user has something to act on; when it names nothing, saying
      ; "Application using it: unknown process -- close the application listed
      ; above" is an instruction that cannot be followed, and the old text also
      ; sent people to reboot Windows over what is usually a handle that clears
      ; itself in seconds.
      ${If} $OneWorkLockerIdentified == "1"
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${ONEWORK_MSG_FILE_OR_FOLDER_IN_USE_ZH}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${ONEWORK_MSG_APPLICATION_USING_IT_ZH}$\r$\n$OneWorkLockerListZh$\r$\n$\r$\n${ONEWORK_MSG_CLOSE_LISTED_RETRY_ZH}$\r$\n$\r$\n${ONEWORK_MSG_INSTALLER_LOG_ZH}:$\r$\n$OneWorkSessionLogPath$\r$\n$\r$\n${ONEWORK_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${ONEWORK_MSG_FILE_OR_FOLDER_IN_USE_EN}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${ONEWORK_MSG_APPLICATION_USING_IT_EN}$\r$\n$OneWorkLockerListEn$\r$\n$\r$\n${ONEWORK_MSG_CLOSE_LISTED_RETRY_EN}$\r$\n$\r$\n${ONEWORK_MSG_INSTALLER_LOG_EN}:$\r$\n$OneWorkSessionLogPath" /SD IDCANCEL IDRETRY ${_RETRY_LABEL} IDCANCEL ${_CANCEL_LABEL}
      ${Else}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${ONEWORK_MSG_FILE_OR_FOLDER_IN_USE_ZH}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${ONEWORK_MSG_NO_LOCKER_FOUND_ZH}$\r$\n$\r$\n${ONEWORK_MSG_NO_LOCKER_RETRY_ZH}$\r$\n$\r$\n${ONEWORK_MSG_INSTALLER_LOG_ZH}:$\r$\n$OneWorkSessionLogPath$\r$\n$\r$\n${ONEWORK_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${ONEWORK_MSG_FILE_OR_FOLDER_IN_USE_EN}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${ONEWORK_MSG_NO_LOCKER_FOUND_EN}$\r$\n$\r$\n${ONEWORK_MSG_NO_LOCKER_RETRY_EN}$\r$\n$\r$\n${ONEWORK_MSG_INSTALLER_LOG_EN}:$\r$\n$OneWorkSessionLogPath" /SD IDCANCEL IDRETRY ${_RETRY_LABEL} IDCANCEL ${_CANCEL_LABEL}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Goto ${_CONTINUE_LABEL}
!macroend

!macro ONEWORK_WRITE_INSTALLER_LAST_FAILURE_MARKER
  Push $9
  ${If} $OneWorkIsUpdated == "1"
    ${If} ${Silent}
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
        $$ErrorActionPreference = 'Stop'; \
        $$appDir = Join-Path $$env:APPDATA 'One Work'; \
        $$marker = Join-Path $$appDir 'installer-last-failure.json'; \
        $$log = '$OneWorkSessionLogPath'; \
        if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
        try { \
          New-Item -ItemType Directory -Path $$appDir -Force | Out-Null; \
          $$payload = [ordered]@{ \
            schemaVersion = 1; \
            kind = 'app-cannot-be-closed'; \
            phase = 'customCheckAppRunning'; \
            silent = $$true; \
            updated = $$true; \
            retryCount = 3; \
            instDir = '$INSTDIR'; \
            logPath = $$log; \
            at = (Get-Date -Format o) \
          }; \
          $$json = $$payload | ConvertTo-Json -Compress -Depth 4; \
          [System.IO.File]::WriteAllText($$marker, $$json, (New-Object System.Text.UTF8Encoding $$false)); \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'ok'; path = $$marker; marker = $$payload }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } catch { \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$OneWorkSessionId'; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'failed'; path = $$marker; error = $$_.Exception.Message }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } \
      }"`
      Pop $9
    ${EndIf}
  ${EndIf}
  Pop $9
!macroend

!macro customCheckAppRunning
  Var /GLOBAL OneWorkCheckResult
  Var /GLOBAL OneWorkCloseRetries
  Var /GLOBAL OneWorkCloseWaitMs
  InitPluginsDir
  !insertmacro ONEWORK_SESSION_BEGIN

  !insertmacro ONEWORK_WAIT_FOR_UPDATED_APP_EXIT
  !insertmacro ONEWORK_FIND_APP_PROCESS $OneWorkCheckResult
  ${If} $OneWorkCheckResult == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK onework_do_stop_process
    !insertmacro ONEWORK_CLEAR_ACTIVE_INSTALLER_MARKER
    Quit

    onework_do_stop_process:
      DetailPrint "$(appClosing)"
      !insertmacro ONEWORK_STOP_APP_PROCESSES
      StrCpy $OneWorkCloseRetries 0

    onework_wait_for_close:
      ; Back off instead of polling flat every second. A flat 1s x 10 gives the
      ; app 10 seconds to shut down; an Electron app flushing a large session
      ; database routinely needs more than that, and the old loop declared
      ; failure while it was still making progress. Scaling the wait with the
      ; attempt count gets ~35s of patience out of the same 10 attempts, and
      ; costs nothing in the common case where the app exits on the first poll.
      IntOp $OneWorkCloseWaitMs $OneWorkCloseRetries * 500
      IntOp $OneWorkCloseWaitMs $OneWorkCloseWaitMs + 1000
      Sleep $OneWorkCloseWaitMs
      !insertmacro ONEWORK_FIND_APP_PROCESS $OneWorkCheckResult
      ${If} $OneWorkCheckResult == 0
        IntOp $OneWorkCloseRetries $OneWorkCloseRetries + 1
        ${If} $OneWorkCloseRetries > 10
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${ONEWORK_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}$\r$\n$\r$\n${ONEWORK_MSG_MAY_USE_INSTALL_DIR_ZH}$\r$\n$INSTDIR$\r$\n$\r$\n${ONEWORK_MSG_RETRY_AFTER_CLOSING_DIR_ZH}$\r$\n$\r$\n${ONEWORK_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${ONEWORK_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}$\r$\n$\r$\n${ONEWORK_MSG_MAY_USE_INSTALL_DIR_EN}$\r$\n$INSTDIR$\r$\n$\r$\n${ONEWORK_MSG_RETRY_AFTER_CLOSING_DIR_EN}" /SD IDCANCEL IDRETRY onework_wait_for_close
          !insertmacro ONEWORK_WRITE_INSTALLER_LAST_FAILURE_MARKER
          !insertmacro ONEWORK_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${ONEWORK_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=app-cannot-be-closed retryCount=$OneWorkCloseRetries instDir=$INSTDIR" "${ONEWORK_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}" "${ONEWORK_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}" "${ONEWORK_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${ONEWORK_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}" "app-cannot-be-closed retryCount=$OneWorkCloseRetries instDir=$INSTDIR" "app-cannot-be-closed retryCount=$OneWorkCloseRetries instDir=$INSTDIR"
        ${Else}
          !insertmacro ONEWORK_STOP_APP_PROCESSES
          Goto onework_wait_for_close
        ${EndIf}
      ${EndIf}
  ${EndIf}

!macroend

!endif
