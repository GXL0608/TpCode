param(
  [string]$OpencodeExe = "opencode.exe",
  [string]$SourceSqlitePath = "",
  [string]$PgUrl = "postgres://opencode:opencode@182.92.74.187:9124/opencode"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_shared.ps1")

$exe = Resolve-OpencodeExe -InputPath $OpencodeExe
if ([string]::IsNullOrWhiteSpace($SourceSqlitePath)) {
  $SourceSqlitePath = Get-SqlitePathFromCli -Exe $exe
}

if (!(Test-Path $SourceSqlitePath)) {
  throw "Source SQLite file not found: $SourceSqlitePath"
}

Set-OpencodeServerEnv -PgUrl $PgUrl

Write-Host "Replacing PostgreSQL data from SQLite source:"
Write-Host "  $SourceSqlitePath"
& $exe db replace $SourceSqlitePath
if ($LASTEXITCODE -ne 0) {
  throw "db replace failed with exit code $LASTEXITCODE"
}

Write-Host "Verifying row counts between local SQLite and PostgreSQL..."
$verifyOut = & $exe db verify 2>&1
$verifyCode = $LASTEXITCODE
$verifyText = ($verifyOut | Out-String)
$verifyOut | Out-Host
if ($verifyCode -ne 0) {
  throw "db verify failed with exit code $verifyCode"
}

$required = @(
  "project",
  "session",
  "message",
  "part",
  "sync_queue",
  "sync_state",
  "tp_organization",
  "tp_department",
  "tp_user",
  "tp_role",
  "tp_permission",
  "tp_change_request",
  "tp_approval",
  "tp_timeline"
)
$missing = @($required | Where-Object { $verifyText -notmatch "(?m)^$($_)\s+" })
if ($missing.Count -gt 0) {
  throw "Required tables not present in verify output: $($missing -join ', ')"
}

Write-Host "Migration and verification complete."
