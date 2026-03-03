param(
  [string]$OpencodeExe = "opencode.exe",
  [string]$SourceSqlitePath = "",
  [string]$BackupRoot = "C:\opencode-backups",
  [string]$PgUrl = "postgres://opencode:opencode@182.92.74.187:9124/opencode",
  [int]$Port = 4096,
  [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$stop = Join-Path $PSScriptRoot "stop-server.ps1"
$backup = Join-Path $PSScriptRoot "backup-db.ps1"
$migrate = Join-Path $PSScriptRoot "migrate-db.ps1"
$start = Join-Path $PSScriptRoot "start-server.ps1"

Write-Host "1/4 Stop old server..."
& $stop -OpencodeExe $OpencodeExe -Port $Port

Write-Host "2/4 Backup SQLite + PostgreSQL..."
& $backup -OpencodeExe $OpencodeExe -BackupRoot $BackupRoot -PgUrl $PgUrl

Write-Host "3/4 Replace and verify PostgreSQL..."
if ([string]::IsNullOrWhiteSpace($SourceSqlitePath)) {
  & $migrate -OpencodeExe $OpencodeExe -PgUrl $PgUrl
} else {
  & $migrate -OpencodeExe $OpencodeExe -SourceSqlitePath $SourceSqlitePath -PgUrl $PgUrl
}

if ($NoStart) {
  Write-Host "4/4 Skipped start (NoStart)."
  exit 0
}

Write-Host "4/4 Start new server..."
& $start -OpencodeExe $OpencodeExe -Port $Port -PgUrl $PgUrl
