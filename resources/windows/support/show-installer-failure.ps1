param(
  [string]$CopyArchive,
  [string]$ResultPath,
  [string]$LogPath,
  [string]$ExtractLogPath,
  [string]$Code,
  [string]$Detail,
  [string]$MessageZh,
  [string]$MessageEn,
  [string]$ActionZh,
  [string]$ActionEn,
  [string]$Release,
  [string]$Arch,
  [string]$Session,
  [string]$InstallDir,
  [string]$InstallerPath,
  [string]$OutputDirectory,
  [int]$Language = 2052,
  [switch]$NoUi
)

$ErrorActionPreference = 'Stop'
if ($CopyArchive) {
  try {
    $report = Join-Path ([IO.Path]::ChangeExtension($CopyArchive, $null)) 'report.txt'
    $copyText = [IO.File]::ReadAllText($report) + "`r`nDiagnostics ZIP / 诊断包: $CopyArchive"
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.Clipboard]::SetText($copyText)
    exit 0
  } catch { exit 2 }
}
$isChinese = $Language -eq 2052 -or $Language -eq 1028
$utf8 = New-Object System.Text.UTF8Encoding $true
try {
  if (-not $OutputDirectory) {
    $storageRoot = $env:LOCALAPPDATA
    if (-not $storageRoot) { $storageRoot = $env:TEMP }
    $OutputDirectory = Join-Path $storageRoot 'OneWork-InstallerDiagnostics'
  }
  $safeSession = $Session -replace '[^a-zA-Z0-9_-]', '_'
  if (-not $safeSession) { $safeSession = [guid]::NewGuid().ToString('N').Substring(0, 12) }
  $safeVersion = $Release -replace '[^a-zA-Z0-9._-]', '_'
  $name = 'onework-installer-' + $safeVersion + '-' + $safeSession + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
  $reportDirectory = Join-Path $OutputDirectory $name
  New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
  $events = @()
  if ($LogPath -and (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    # A daily log can contain other attempts. Export only this installer session.
    $events = @(Get-Content -LiteralPath $LogPath -Encoding UTF8 -Tail 4000 | Where-Object {
      try { $event = $_ | ConvertFrom-Json; $event.session -eq $(if ($Session) { $Session } else { 'uninitialized' }) } catch { $false }
    })
  }
  [IO.File]::WriteAllLines((Join-Path $reportDirectory 'installer-session.jsonl'), [string[]]$events, $utf8)
  $extractOutput = ''
  if ($ExtractLogPath -and (Test-Path -LiteralPath $ExtractLogPath -PathType Leaf)) {
    $extractOutput = [IO.File]::ReadAllText($ExtractLogPath, [Text.Encoding]::Unicode)
    [IO.File]::WriteAllText((Join-Path $reportDirectory 'extractor-output.txt'), $extractOutput, $utf8)
  }
  $driveInfo = @()
  foreach ($directory in @($InstallDir, $env:TEMP)) {
    try {
      $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($directory)))
      $driveInfo += [ordered]@{ path = $directory; drive = $drive.Name; freeBytes = $drive.AvailableFreeSpace; totalBytes = $drive.TotalSize }
    } catch { $driveInfo += [ordered]@{ path = $directory; error = $_.Exception.Message } }
  }
  $installer = [ordered]@{ path = $InstallerPath; sha256 = ''; bytes = $null }
  if ($InstallerPath -and (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    $installer.bytes = (Get-Item -LiteralPath $InstallerPath).Length
    $stream = [IO.File]::OpenRead($InstallerPath)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $installer.sha256 = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
    finally { $hasher.Dispose(); $stream.Dispose() }
  }
  $diagnostics = [ordered]@{
    schemaVersion = 1; timestamp = (Get-Date -Format o); code = $Code; detail = $Detail
    version = $Release; arch = $Arch; session = $Session; installDirectory = $InstallDir
    installPathLength = $InstallDir.Length; tempDirectory = $env:TEMP
    windowsVersion = [Environment]::OSVersion.VersionString
    is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    installer = $installer; disks = $driveInfo; sessionEventCount = $events.Count
    extractorOutput = $extractOutput; sourceLog = $LogPath
  }
  [IO.File]::WriteAllText((Join-Path $reportDirectory 'diagnostics.json'), ($diagnostics | ConvertTo-Json -Depth 6), $utf8)
  $summary = "One Work installation failed ($Code) / One Work 安装失败`r`n$MessageZh`r`n$MessageEn`r`nSuggested action: $ActionEn`r`n建议: $ActionZh`r`nInstaller log: $LogPath`r`nCode: $Code`r`nVersion: $Release ($Arch)`r`nSession: $Session`r`nStage/detail: $Detail`r`nInstall directory: $InstallDir`r`nPath length: $($InstallDir.Length)`r`nWindows: $($diagnostics.windowsVersion)`r`nTEMP: $env:TEMP`r`nDisks: $($driveInfo | ConvertTo-Json -Compress)`r`nExtractor output:`r`n$extractOutput`r`nInstaller SHA256: $($installer.sha256)`r`n"
  [IO.File]::WriteAllText((Join-Path $reportDirectory 'report.txt'), $summary, $utf8)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = Join-Path $OutputDirectory ($name + '.zip')
  [IO.Compression.ZipFile]::CreateFromDirectory($reportDirectory, $archive)
  $summary += "`r`nDiagnostics ZIP / 诊断包: $archive`r`nLocal collection only; nothing uploaded / 仅本地采集，未上传。"
  if ($ResultPath) { [IO.File]::WriteAllText($ResultPath, $archive, [Text.Encoding]::Unicode) }
  else { [Console]::Out.Write($archive) }
} catch {
  Write-Output ('Diagnostic collection failed: ' + $_.Exception.Message)
  exit 2
}

exit 0
