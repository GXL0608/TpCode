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

## 7) Apply delta package

Apply an extracted delta directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\apply-delta.ps1 -DeltaPath "D:\release\app-delta" -TargetRoot "C:\svc\tpcode-web"
```

Apply a zip delta package:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\windows\apply-delta.ps1 -DeltaPath "D:\release\app-delta.zip" -TargetRoot "C:\svc\tpcode-web"
```

Typical targets:

- `ASP.NET` / `MVC API`: point `-TargetRoot` to the published output directory, for example `C:\svc\MyApi\publish`
- `WinForms`: if you use xcopy-style deployment, point `-TargetRoot` to the application directory, for example `C:\apps\MyWinForms`
- `WinForms` installer-based deployment is still recommended to stay on full package updates

## 8) Run delta preview server manually

From repo root:

```powershell
bun .\script\delta-preview-fixed.ts
```

Default port is `4097` to avoid colliding with the main local service. Override it if needed:

```powershell
$env:TPCODE_DELTA_PORT = "4100"
bun .\script\delta-preview-fixed.ts
```
