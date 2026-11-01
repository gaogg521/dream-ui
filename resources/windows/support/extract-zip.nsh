!ifndef ONEWORK_EXTRACT_ZIP_NSH
!define ONEWORK_EXTRACT_ZIP_NSH

; The legacy nsisunz plugin fails on otherwise valid output paths >= MAX_PATH.
; Use the checksum-pinned, long-path-capable Windows 7za embedded at build time.
; No downloads, system settings, or PowerShell extraction are needed at install time.
!macro ONEWORK_EXTRACT_ZIP _ARCHIVE
  File /oname=$PLUGINSDIR\onework-7za.exe "$%ONEWORK_INSTALLER_7ZA%"
  File /oname=$PLUGINSDIR\onework-7za-LICENSE.txt "$%ONEWORK_INSTALLER_7ZA_LICENSE%"
  File /oname=$PLUGINSDIR\onework-7za-COPYING.txt "$%ONEWORK_INSTALLER_7ZA_COPYING%"
  !insertmacro ONEWORK_SLOG "event=extract-start method=zip-7za"
  nsExec::ExecToStack '"$PLUGINSDIR\onework-7za.exe" x "${_ARCHIVE}" "-o$INSTDIR" -y -aoa -bso0 -bsp0'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    !insertmacro ONEWORK_FAIL_UX \
      "${ONEWORK_E_EXTRACT_FAILED}" \
      "extract method=zip-7za exitCode=$R0" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ZH}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_EN}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ACTION_ZH}" \
      "${ONEWORK_MSG_EXTRACT_FAILED_ACTION_EN}" \
      "method=zip-7za exitCode=$R0 instDir=$INSTDIR" \
      "method=zip-7za exitCode=$R0 instDir=$INSTDIR"
  ${EndIf}
  !insertmacro ONEWORK_SLOG "event=extract-complete method=zip-7za result=ok"
!macroend

!endif
