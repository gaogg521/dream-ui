; Custom NSIS installer script — auto-included by electron-builder because it
; lives in buildResources (resources/) and is named installer.nsh.
;
; Purpose: pin the DEFAULT install directory to "1onecode" (matching
; executableName) instead of the productName-derived "1ONE Code" / a stale
; "AionUi" location remembered from an earlier build under the same appId.
;
; preInit runs before electron-builder computes $INSTDIR, so seeding
; InstallLocation in the registry makes the installer default to it. The user
; can still change it (allowToChangeInstallationDirectory: true).
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\1onecode"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\1onecode"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\1onecode"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\1onecode"
!macroend
