param(
  [string]$OpencodeExe = "opencode.exe",
  [string]$BackupRoot = "C:\opencode-backups",
  [string]$PgUrl = "postgres://opencode:opencode@182.92.74.187:9124/opencode"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_shared.ps1")

$exe = Resolve-OpencodeExe -InputPath $OpencodeExe
$sqlitePath = Get-SqlitePathFromCli -Exe $exe

if (!(Test-Path $sqlitePath)) {
  throw "SQLite file not found: $sqlitePath"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dir = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$sqliteFile = Join-Path $dir "opencode.sqlite.db"
Copy-Item -Path $sqlitePath -Destination $sqliteFile -Force

if (Test-Path "$sqlitePath-wal") {
  Copy-Item -Path "$sqlitePath-wal" -Destination (Join-Path $dir "opencode.sqlite.db-wal") -Force
}
if (Test-Path "$sqlitePath-shm") {
  Copy-Item -Path "$sqlitePath-shm" -Destination (Join-Path $dir "opencode.sqlite.db-shm") -Force
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (!$pgDump) {
  throw "pg_dump not found in PATH. Install PostgreSQL client tools first."
}

$pgFile = Join-Path $dir "opencode.pg.dump"
& $pgDump.Source "--dbname=$PgUrl" "--format=custom" "--file=$pgFile" "--no-owner" "--no-privileges"
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

$meta = @{
  time = (Get-Date).ToString("o")
  opencode_exe = $exe
  sqlite_source = $sqlitePath
  sqlite_backup = $sqliteFile
  pg_backup = $pgFile
}
$meta | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $dir "backup-meta.json") -Encoding UTF8

Write-Host "Backup complete:"
Write-Host "  $dir"
