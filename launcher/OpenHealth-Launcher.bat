@echo off
setlocal
cd /d "C:\Users\trevo\Documents\GitHub\open-health"
REM Make pdf2pic's GraphicsMagick + Ghostscript visible to the app only
set "PATH=C:\Users\trevo\tools\GraphicsMagick;C:\Users\trevo\tools\Ghostscript\bin;%PATH%"
echo [%date% %time%] OpenHealth launcher starting

REM 1) Docker engine
docker info >nul 2>&1
if not errorlevel 1 goto dockerready
echo [1/4] Starting Docker Desktop, first run can take ~30s...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
:dockerwait
docker info >nul 2>&1
if not errorlevel 1 goto dockerready
ping -n 4 127.0.0.1 >nul
goto dockerwait
:dockerready
echo [1/4] Docker is ready

REM 2) Database + Docling parser
echo [2/4] Starting database and Docling...
docker compose --env-file .env up -d database docling-serve >nul 2>&1
:pgwait
docker compose exec -T database pg_isready -U postgres >nul 2>&1
if not errorlevel 1 goto pgready
ping -n 3 127.0.0.1 >nul
goto pgwait
:pgready
echo [2/4] Database and Docling are ready

REM 3) App on port 3000
powershell -NoProfile -Command "try{$c=New-Object System.Net.Sockets.TcpClient;$c.Connect('localhost',3000);$c.Close();exit 0}catch{exit 1}"
if not errorlevel 1 goto appready
echo [3/4] Starting app, first launch compiles in ~15s...
wscript "C:\Users\trevo\Documents\GitHub\open-health\launcher\open-health-dev.vbs"
:appwait
powershell -NoProfile -Command "try{$c=New-Object System.Net.Sockets.TcpClient;$c.Connect('localhost',3000);$c.Close();exit 0}catch{exit 1}"
if not errorlevel 1 goto appready
ping -n 3 127.0.0.1 >nul
goto appwait
:appready
echo [3/4] App is ready

REM 4) Browser
echo [4/4] Opening http://localhost:3000
start "" http://localhost:3000
echo [%date% %time%] Done.
endlocal
