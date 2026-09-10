; Custom NSIS installer script — auto-included by electron-builder because it
; lives in buildResources (resources/) and is named installer.nsh.
;
; Two jobs: pin the DEFAULT install directory to "onework", and make sure the
; directories older builds installed into do not survive as extra copies of the
; app. Measured on a real machine mid-upgrade: "One Work", "onework" and
; "1onecode" all present under Programs, 2.28 GB each, 6.8 GB of duplicates.
;
; Why the second job is ours and not electron-builder's:
;
; `InstallLocation` under ${INSTALL_REGISTRY_KEY} is one value doing two jobs.
; `multiUser.nsh` reads it during .onInit to seed $INSTDIR (where the NEW
; version goes) and `installUtil.nsh` reads it in the install section to find
; the OLD one, which it then uninstalls with `_?=$installationDir`. One value,
; two meanings, and across a rename they disagree.
;
; Worse, it is not even reliably present. On a machine carrying all three
; installs the value did not exist under either uninstall key — only
; DisplayName and UninstallString did — and no registry entry anywhere pointed
; at the orphaned "One Work" directory at all. `installer-repair-heal.nsh`
; already carries an empty-InstallLocation branch for the same reason. So a
; cleanup that reads the registry to learn where the old install is cannot
; find the very directories this exists to remove.
;
; Hence both paths below: the registry when it has an answer, and the list of
; names this app has actually shipped under when it does not. That list is not
; a guess — `executableName` went 1onecode -> One Work -> onework, and each
; value is what NSIS derived the install directory from.

!define DREAM_INSTALL_ROOT "$LOCALAPPDATA\Programs"
!define DREAM_TARGET_DIR "${DREAM_INSTALL_ROOT}\onework"

; Remove one former install directory, if it is safe to.
;
; Three conditions, all required. A path being on the list is not enough on its
; own to justify RMDir /r on a user's disk:
;   - not the directory we just installed into (the user may have pointed this
;     install at the old path — allowToChangeInstallationDirectory is on);
;   - it exists;
;   - it contains resources\app.asar, which every Electron build we ship has
;     and almost nothing else does.
!macro DreamRemoveStaleInstall DIR
  StrCmp "${DIR}" "" dreamSkip_${__LINE__}
  StrCmp "${DIR}" "$INSTDIR" dreamSkip_${__LINE__}
  IfFileExists "${DIR}\resources\app.asar" 0 dreamSkip_${__LINE__}
    DetailPrint "Removing a previous installation at ${DIR}"
    RMDir /r "${DIR}"
  dreamSkip_${__LINE__}:
!macroend

; preInit runs before electron-builder computes $INSTDIR, so seeding
; InstallLocation is what makes the installer default to "onework". The user
; can still change it (allowToChangeInstallationDirectory: true).
!macro preInit
  SetRegView 64
  ; Read before writing: when the value IS present it names the previous
  ; install, and the four writes below are about to replace it.
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R7 "" 0 +2
    ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation

  StrCmp $R7 "" skipStash
  StrCmp $R7 "${DREAM_TARGET_DIR}" skipStash
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation "$R7"
  skipStash:

  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "${DREAM_TARGET_DIR}"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "${DREAM_TARGET_DIR}"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "${DREAM_TARGET_DIR}"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "${DREAM_TARGET_DIR}"
!macroend

; Runs after the new version's files are in place (installSection.nsh), so
; $INSTDIR is real and populated before anything below is deleted.
!macro customInstall
  Push $R7
  SetRegView 64

  ; 1. Whatever the registry knew about, if anything.
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation
  !insertmacro DreamRemoveStaleInstall "$R7"
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation

  ; 2. The names this app has shipped under. The registry did not name these on
  ;    the machine where the duplicates were found, and nothing else will.
  !insertmacro DreamRemoveStaleInstall "${DREAM_INSTALL_ROOT}\One Work"
  !insertmacro DreamRemoveStaleInstall "${DREAM_INSTALL_ROOT}\1onecode"

  Pop $R7
!macroend
