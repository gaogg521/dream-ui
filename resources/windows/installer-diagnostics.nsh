!ifndef ONEWORK_INSTALLER_DIAGNOSTICS_NSH
!define ONEWORK_INSTALLER_DIAGNOSTICS_NSH

XPStyle on

Var /GLOBAL OneWorkFailureCode
Var /GLOBAL OneWorkFailureDetail
Var /GLOBAL OneWorkFailureMessage
Var /GLOBAL OneWorkFailureAction
Var /GLOBAL OneWorkFailureDialogResult
Var /GLOBAL OneWorkFailureCopyStatus

; NSIS is a 32-bit process even on x64 Windows. TASKDIALOGCONFIG is 96 bytes.
; Keep the error UI native to the installer; PowerShell only collects local files.
Function OneWorkShowInstallerDiagnostics
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $OneWorkFailureDialogResult "0"
  StrCpy $OneWorkFailureCopyStatus ""
  onework_diagnostics_again:
  System::Call '*(&w${NSIS_MAX_STRLEN} "One Work - $OneWorkFailureCode") p.r0'
  System::Call '*(&w${NSIS_MAX_STRLEN} "$OneWorkFailureMessage$\r$\n$\r$\nSuggested action / 建议:$\r$\n$OneWorkFailureAction$\r$\n$\r$\nCode: $OneWorkFailureCode$\r$\nStage/detail: $OneWorkFailureDetail$\r$\nInstaller log: $OneWorkSessionLogPath$\r$\nDiagnostics ZIP / 诊断包:$\r$\n$OneWorkDiagnosticsPath$\r$\n$\r$\n仅本地采集，未上传。Local collection only; nothing uploaded.$\r$\n$OneWorkFailureCopyStatus") p.r1'
  ${If} $LANGUAGE == 2052
  ${OrIf} $LANGUAGE == 1028
    System::Call '*(&w80 "复制诊断信息") p.r2'
    System::Call '*(&w80 "打开诊断文件夹") p.r3'
    System::Call '*(&w80 "发送报告给团队") p.r4'
    System::Call '*(&w80 "关闭") p.r5'
  ${Else}
    System::Call '*(&w80 "Copy diagnostics") p.r2'
    System::Call '*(&w80 "Open diagnostics folder") p.r3'
    System::Call '*(&w80 "Send report to team") p.r4'
    System::Call '*(&w80 "Close") p.r5'
  ${EndIf}
  System::Call '*(i 101, p r2, i 102, p r3, i 104, p r4, i 103, p r5) p.r6'
  System::Call '*(i 96, p $HWNDPARENT, p 0, i 8, i 0, p r0, p 65534, p r0, p r1, i 4, p r6, i 103, i 0, p 0, i 0, p 0, p 0, p 0, p 0, p 0, p 0, p 0, p 0, i 0) p.r7'
  System::Call 'comctl32::TaskDialogIndirect(p r7, *i .r8, p 0, p 0) i.r9'
  System::Free $7
  System::Free $6
  System::Free $5
  System::Free $4
  System::Free $3
  System::Free $2
  System::Free $1
  System::Free $0
  ${If} $9 != 0
    !insertmacro ONEWORK_SLOG "event=diagnostics-ui-fallback hresult=$9"
    MessageBox MB_OK|MB_ICONSTOP "One Work installation failed ($OneWorkFailureCode)$\r$\n$OneWorkFailureDetail$\r$\nDiagnostics ZIP: $OneWorkDiagnosticsPath$\r$\nInstaller log: $OneWorkSessionLogPath$\r$\nCtrl+C: 复制此信息 / Copy this information" /SD IDOK
  ${ElseIf} $8 == 101
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "$PLUGINSDIR\onework-show-installer-failure.ps1" -CopyArchive "$OneWorkDiagnosticsPath" -NoUi`
    Pop $9
    ${If} $9 == 0
      StrCpy $OneWorkFailureCopyStatus "已复制诊断信息 / Diagnostics copied."
    ${Else}
      StrCpy $OneWorkFailureCopyStatus "复制失败，请打开诊断文件夹 / Copy failed; please open the diagnostics folder."
    ${EndIf}
    Goto onework_diagnostics_again
  ${ElseIf} $8 == 102
    Exec '"$WINDIR\explorer.exe" /select,"$OneWorkDiagnosticsPath"'
  ${ElseIf} $8 == 104
    StrCpy $OneWorkFailureDialogResult "10"
  ${EndIf}
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!endif
