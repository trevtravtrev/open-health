@echo off
setlocal
cd /d "C:\Users\trevo\Documents\GitHub\open-health"
REM DB backups live OUTSIDE the repo (so health data never lands in git) but INSIDE
REM Documents (so the daily C: -> NAS backup picks them up).
set "BACKUPDIR=C:\Users\trevo\Documents\open-health-backups"
echo ==============================================
echo  Stopping OpenHealth (clean + data-safe)
echo ==============================================

REM 0) Back up the database to Documents BEFORE stopping the containers.
if not exist "%BACKUPDIR%" mkdir "%BACKUPDIR%" >nul 2>&1
echo [1/4] Backing up database -^> %BACKUPDIR%\db-backup.sql ...
docker compose --env-file .env exec -T database pg_dump -U postgres open-health > "%BACKUPDIR%\db-backup-new.sql" 2>nul
if errorlevel 1 (
    echo       WARNING: pg_dump failed - keeping previous backup if one exists
    del "%BACKUPDIR%\db-backup-new.sql" 2>nul
) else (
    move /y "%BACKUPDIR%\db-backup-new.sql" "%BACKUPDIR%\db-backup.sql" >nul
    echo       backup saved
)

REM 1) Stop the hidden dev server (owner of port 3000)
echo [2/4] Stopping app (port 3000)...
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host '       app stopped' } else { Write-Host '       app was not running' }"

REM 2) Stop + remove THIS project's containers (database + docling-serve).
REM    NOTE: 'down' WITHOUT -v keeps the postgres_data volume =^> NO data loss.
REM    We never pass -v here on purpose.
echo [3/4] Stopping containers (database, docling-serve)...
docker compose --env-file .env down >nul 2>&1
if errorlevel 1 (
    echo       warning: docker not reachable or containers already stopped
) else (
    echo       containers stopped
)

REM 3) Confirm
echo [4/4] Remaining OpenHealth containers:
docker compose ps -a 2>nul
echo.
echo ==============================================
echo  Done. DB backup: %BACKUPDIR%\db-backup.sql
echo  Data SAFE (volume preserved). Docker left
echo  running. To restart: OpenHealth desktop icon.
echo ==============================================
timeout /t 6 >nul
endlocal
