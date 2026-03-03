param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir,
  [string]$OpencodeExe = "opencode.exe",
  [int]$Port = 4096,
  [string]$PgUrl = "postgres://opencode:opencode@182.92.74.187:9124/opencode"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$stop = Join-Path $PSScriptRoot "stop-server.ps1"
& $stop -OpencodeExe $OpencodeExe -Port $Port

$sqliteBackup = Join-Path $BackupDir "opencode.sqlite.db"
if (!(Test-Path $sqliteBackup)) {
  throw "SQLite backup file not found: $sqliteBackup"
}

. (Join-Path $PSScriptRoot "_shared.ps1")
$exe = Resolve-OpencodeExe -InputPath $OpencodeExe
$sqlitePath = Get-SqlitePathFromCli -Exe $exe

New-Item -ItemType Directory -Force -Path (Split-Path $sqlitePath -Parent) | Out-Null
Copy-Item -Path $sqliteBackup -Destination $sqlitePath -Force
if (Test-Path (Join-Path $BackupDir "opencode.sqlite.db-wal")) {
  Copy-Item -Path (Join-Path $BackupDir "opencode.sqlite.db-wal") -Destination "$sqlitePath-wal" -Force
}
if (Test-Path (Join-Path $BackupDir "opencode.sqlite.db-shm")) {
  Copy-Item -Path (Join-Path $BackupDir "opencode.sqlite.db-shm") -Destination "$sqlitePath-shm" -Force
}

$pgBackup = Join-Path $BackupDir "opencode.pg.dump"
if (!(Test-Path $pgBackup)) {
  throw "PostgreSQL backup file not found: $pgBackup"
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (!$pgRestore) {
  throw "pg_restore not found in PATH. Install PostgreSQL client tools first."
}

& $pgRestore.Source "--dbname=$PgUrl" "--clean" "--if-exists" "--no-owner" "--no-privileges" $pgBackup
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE"
}

Write-Host "Restore complete from backup:"
Write-Host "  $BackupDir"
