!ifndef ONEWORK_INSTALLER_OBSERVABILITY_NSH
!define ONEWORK_INSTALLER_OBSERVABILITY_NSH

; Fork-owned single source of truth for the packaged app executable name.
; electron-builder derives it from productName ("One Work") now that
; electron-builder.yml has no `executableName` override.
; Consumed here (extract check) and by installer-update-verify / process-control /
; repair-heal. electron-builder also exposes ${APP_EXECUTABLE_FILENAME} = the same
; value, but its include order relative to this file is not guaranteed, so we keep
; a self-contained literal.
!define ONEWORK_APP_EXECUTABLE_FILENAME "onework.exe"
!define ONEWORK_FALLBACK_LOG "onework-installer-${VERSION}-fallback-log.jsonl"

!pragma warning disable 6001
Var /GLOBAL OneWorkSessionId
Var /GLOBAL OneWorkIsUpdated
Var /GLOBAL OneWorkSessionLogResult
Var /GLOBAL OneWorkSessionLogPath

!macro ONEWORK_SESSION_HEADER
  !insertmacro ONEWORK_SLOG "event=header arch=${ONEWORK_TARGET_ARCH} updated=$OneWorkIsUpdated instDir=$INSTDIR version=${VERSION} log=$OneWorkSessionLogPath detail=customHeader"
!macroend

!macro ONEWORK_SLOG _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$session = '$OneWorkSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro ONEWORK_LOG_EVENT _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$session = '$OneWorkSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro ONEWORK_LOG_JSON_EVENT _EVENT _JSON_FIELDS
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$OneWorkSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${ONEWORK_FALLBACK_LOG}' }; \
    $$session = '$OneWorkSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${ONEWORK_TARGET_ARCH}'; updated = ('$OneWorkIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = '${_EVENT}' }; \
    ${_JSON_FIELDS}; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro ONEWORK_SESSION_BEGIN
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "--installer-log=" $R8
  ${IfNot} ${Errors}
    StrCpy $OneWorkSessionLogPath $R8
  ${EndIf}
  ClearErrors
  ${GetOptions} $R9 "--installer-session=" $R8
  ${IfNot} ${Errors}
    StrCpy $OneWorkSessionId $R8
  ${EndIf}

  ${If} $OneWorkSessionLogPath == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$id = '$OneWorkSessionId'; if (-not $$id) { $$id = [guid]::NewGuid().ToString('N').Substring(0,12) }; $$stamp = Get-Date -Format 'yyyyMMdd'; $$name = 'onework-installer-${VERSION}-' + $$stamp + '-log.jsonl'; $$log = Join-Path $$env:TEMP $$name; [Console]::Out.Write($$id + '|' + $$log)"`
    Pop $OneWorkSessionLogResult
    Pop $OneWorkSessionLogResult
    StrCpy $OneWorkSessionId $OneWorkSessionLogResult 12
    StrCpy $OneWorkSessionLogPath $OneWorkSessionLogResult 1024 13
  ${ElseIf} $OneWorkSessionId == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::Out.Write([guid]::NewGuid().ToString('N').Substring(0,12))"`
    Pop $OneWorkSessionLogResult
    Pop $OneWorkSessionLogResult
    StrCpy $OneWorkSessionId $OneWorkSessionLogResult
  ${EndIf}

  ClearErrors
  ${GetOptions} $R9 "--updated" $R8
  StrCpy $OneWorkIsUpdated "0"
  ${IfNot} ${Errors}
    StrCpy $OneWorkIsUpdated "1"
  ${EndIf}

  !insertmacro ONEWORK_SLOG "event=session-begin detail=preInit"
!macroend

!macro ONEWORK_LOG_EXTRACT_RESULT _METHOD
  ${IfNot} ${FileExists} "$INSTDIR\${ONEWORK_APP_EXECUTABLE_FILENAME}"
    !insertmacro ONEWORK_FAIL_UX \
      "${ONEWORK_E_EXTRACT_FAILED}" \
      "event=extract result=fail method=${_METHOD} missing=${ONEWORK_APP_EXECUTABLE_FILENAME}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ZH}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_EN}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ACTION_ZH}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ACTION_EN}" \
      "extract result=fail method=${_METHOD} missing=${ONEWORK_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR" \
      "extract result=fail method=${_METHOD} missing=${ONEWORK_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR"
  ${Else}
    !insertmacro ONEWORK_SLOG "event=extract result=ok method=${_METHOD} detail=customFiles_${ONEWORK_TARGET_ARCH}"
  ${EndIf}
!macroend

!macro ONEWORK_SESSION_SUCCESS
  !insertmacro ONEWORK_SLOG "event=session-end result=success detail=customInstall"
!macroend

!endif
