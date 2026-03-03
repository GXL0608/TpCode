# Windows CLI build and deploy scripts

All commands below are PowerShell.

## 1) Build Windows CLI package

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\build-cli-win.ps1
```

Build baseline binary:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\build-cli-win.ps1 -Baseline
```

Output:

- `packages\opencode\dist\opencode-windows-x64\bin\opencode.exe`
- `packages\opencode\dist\opencode-windows-x64.zip`

## 2) Backup only

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\backup-db.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe"
```

## 3) Migrate PostgreSQL from server SQLite and verify

If SQLite source is current active DB path:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\migrate-db.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe"
```

If SQLite source is a specific file:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\migrate-db.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe" -SourceSqlitePath "D:\backup\opencode.db"
```

## 4) Start and stop server

Start in background:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\start-server.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe" -Port 4096
```

Stop:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\stop-server.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe" -Port 4096
```

## 5) One-click deploy

Stop old service, backup, migrate, verify, and start:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\deploy.ps1 -OpencodeExe "C:\svc\opencode\opencode.exe" -Port 4096
```

## 6) Rollback

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\restore-from-backup.ps1 -BackupDir "C:\opencode-backups\20260303-120000" -OpencodeExe "C:\svc\opencode\opencode.exe" -Port 4096
```
