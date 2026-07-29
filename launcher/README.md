# Desktop launcher scripts

These start/stop open-health on Windows with no terminal window. They are the
single source of truth for the desktop icons and are tracked in git.

## Files
- `OpenHealth-Launcher.vbs` — what the desktop **OpenHealth** icon runs (no window). Calls the `.bat` and redirects output to `../open-health-launcher.log`.
- `OpenHealth-Launcher.bat` — starts Docker (if needed), `docker compose up -d database docling-serve`, waits for Postgres, starts the dev server hidden, opens the browser. Prepends GraphicsMagick + Ghostscript to PATH for pdf2pic.
- `open-health-dev.vbs` — starts `npm run dev` hidden, logs to `../server.log`.
- `Stop-OpenHealth.bat` — stops ONLY the app (port 3000); leaves containers up for fast restart.
- `Stop-OpenHealth-All.bat` — **full clean stop**: `pg_dump` the DB to `Documents\open-health-backups\db-backup.sql` (picked up by the NAS backup), stop the app, then `docker compose down` (NO `-v`, so the `postgres_data` volume is preserved — zero data loss).
- `install-shortcuts.ps1` — (re)creates the desktop shortcuts pointing at these scripts.

## One-time setup (after cloning)
```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\install-shortcuts.ps1
```

## Notes
- Paths are hardcoded to `C:\Users\trevo\Documents\GitHub\open-health` and `C:\Users\trevo\tools\{GraphicsMagick,Ghostscript}` — this machine's layout.
- Backups intentionally live in `Documents\open-health-backups\` (outside the repo) so health data never enters git, while still being covered by the Documents backup.
- Runtime logs (`server.log`, `open-health-launcher.log`) are gitignored.
