; Custom NSIS installer script — auto-included by electron-builder because it
; lives in buildResources (resources/) and is named installer.nsh.
;
; Purpose: pin the DEFAULT install directory to "One Work" and, on upgrade from
; a pre-rebrand build under the same appId, move it off any stale location
; ("1onecode" / "1ONE Code" / "AionUi") so every install converges on
; "$LOCALAPPDATA\Programs\One Work". The old install's own uninstaller (found via
; the registry UninstallString, keyed on appId) still runs first and clears the
; old directory.
;
; preInit runs before electron-builder computes $INSTDIR, so seeding
; InstallLocation in the registry makes the installer default to it. The user
; can still change it (allowToChangeInstallationDirectory: true).
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\One Work"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\One Work"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\One Work"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\One Work"
!macroend
