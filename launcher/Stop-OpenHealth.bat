@echo off
echo Stopping OpenHealth app on port 3000...
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host 'Stopped the app.' } else { Write-Host 'App was not running on port 3000.' }"
echo Docker containers database and docling-serve are left running for fast restart.
echo For a full stop + DB backup, use Stop-OpenHealth-All.bat instead.
timeout /t 3 >nul
