; Custom NSIS installer script — auto-included by electron-builder because it
; lives in buildResources (resources/) and is named installer.nsh.
;
; Purpose: pin the DEFAULT install directory to "onework" so every install
; converges there, and make sure the directory an older build under the same
; appId installed into ("One Work", "1onecode", ...) does not survive as a
; second copy of the app.
;
; Why both halves live here, and why the second one is not electron-builder's
; job even though it looks like it should be:
;
; `InstallLocation` under ${INSTALL_REGISTRY_KEY} is a single value doing two
; jobs. `multiUser.nsh` reads it during .onInit to seed $INSTDIR (where the NEW
; version goes), and `installUtil.nsh` reads it in the install section to find
; where the OLD version is — it copies that install's uninstaller out and runs
; it with `_?=$installationDir`. One value, two meanings, and on a rename they
; disagree: the new version must go to "onework" while the old one is still in
; "One Work".
;
; Writing the new path in preInit — which is what this file used to do, and the
; only lever that reaches $INSTDIR, since multiUser.nsh runs after preInit and
; would otherwise overwrite it — therefore also told the old uninstaller that it
; was uninstalling from "onework". The real "One Work" directory was never
; touched, and users ended up running two installs side by side.
;
; So: stash the previous location before overwriting it, and clear that
; directory out ourselves once the new install is in place.

!macro preInit
  ; Remember where the previous install actually is. This is the only record of
  ; it, and the next four lines are about to overwrite it.
  SetRegView 64
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R7 "" 0 +2
    ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation

  StrCmp $R7 "" skipStash
  StrCmp $R7 "$LOCALAPPDATA\Programs\onework" skipStash
    ; Somewhere other than where we are going: worth cleaning up later.
    WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation "$R7"
  skipStash:

  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\onework"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\onework"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\onework"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\onework"
!macroend

; Runs after the new version's files are in place (installSection.nsh), so
; $INSTDIR is real and populated by the time anything below is deleted.
!macro customInstall
  ; Unlike preInit, this runs in the middle of the install section, where
  ; electron-builder's own code is using registers. Borrow and give back.
  Push $R7
  SetRegView 64
  ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation
  StrCmp $R7 "" doneStale

  ; Never the directory we just installed into. If the two ever resolved to the
  ; same path, deleting it would remove the install that is running.
  StrCmp $R7 "$INSTDIR" clearStaleValue

  ; Only remove something that is demonstrably one of our own installs. A path
  ; read back from the registry is not enough on its own to justify RMDir /r —
  ; app.asar is present in every Electron build we have ever shipped and in
  ; almost nothing else, so its absence means leave the directory alone.
  IfFileExists "$R7\resources\app.asar" 0 clearStaleValue
    DetailPrint "Removing the previous installation at $R7"
    RMDir /r "$R7"

  clearStaleValue:
    DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" DreamStaleInstallLocation
  doneStale:
  Pop $R7
!macroend
