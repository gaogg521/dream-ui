; ARM64 architecture entry for the NSIS installer.

!include "x64.nsh"

!define ONEWORK_TARGET_ARCH "arm64"
!define ONEWORK_RUNTIME_KEY "win32-arm64"
!define ONEWORK_EXTRACT_METHOD "zip"

!addincludedir "${PROJECT_DIR}\resources\windows"
!include "installer-common.nsh"

!macro customHeader
  !insertmacro ONEWORK_INSTALLER_CUSTOM_HEADER
!macroend

!macro preInit
  !insertmacro ONEWORK_INSTALLER_PREINIT
!macroend

!macro customFiles_arm64
  !insertmacro ONEWORK_LOG_EXTRACT_RESULT "zip"
!macroend

; Architecture guard. Inserted from ONEWORK_INSTALLER_PREINIT (preInit) so it runs before any
; registry mutation, replacing the old .onVerifyInstDir placement which fired after customInit
; had already healed/cleared/repaired an existing install's registry. (Sentry ELECTRON-3BX)
!macro ONEWORK_ASSERT_TARGET_ARCH
  Var /GLOBAL OneWorkActualArch
  ${IfNot} ${IsNativeARM64}
    !insertmacro ONEWORK_DETECT_NATIVE_ARCH $OneWorkActualArch
    !insertmacro ONEWORK_FAIL_UX \
      "${ONEWORK_E_ARCH_MISMATCH}" \
      "target=arm64 actual=$OneWorkActualArch" \
      "${ONEWORK_MSG_ARCH_MISMATCH_ZH}" \
      "${ONEWORK_MSG_ARCH_MISMATCH_EN}" \
      "${ONEWORK_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${ONEWORK_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=arm64 actual=$OneWorkActualArch" \
      "target=arm64 actual=$OneWorkActualArch"
  ${EndIf}
!macroend
