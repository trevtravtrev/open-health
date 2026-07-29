# Recreates the desktop shortcuts from the tracked launcher scripts.
# Run once after cloning (or any time) to (re)create the desktop icons.
# The .lnk files themselves are binary + machine-specific, so instead of committing
# them we commit THIS script - the reproducible source of the shortcuts.
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$repo = 'C:\Users\trevo\Documents\GitHub\open-health\launcher'

$start = $ws.CreateShortcut((Join-Path $desk 'OpenHealth.lnk'))
$start.TargetPath = (Join-Path $repo 'OpenHealth-Launcher.vbs')
$start.WorkingDirectory = $repo
$start.IconLocation = 'imageres.dll,109'
$start.Description = 'Start OpenHealth (app + Postgres + Docling)'
$start.Save()

$stop = $ws.CreateShortcut((Join-Path $desk 'Stop OpenHealth.lnk'))
$stop.TargetPath = (Join-Path $repo 'Stop-OpenHealth-All.bat')
$stop.WorkingDirectory = $repo
$stop.IconLocation = 'imageres.dll,100'
$stop.Description = 'Stop OpenHealth + back up DB (data-safe)'
$stop.Save()

Write-Host "Desktop shortcuts created: OpenHealth.lnk, Stop OpenHealth.lnk (-> $repo)"
