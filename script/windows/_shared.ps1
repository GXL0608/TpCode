Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-OpencodeExe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath
  )

  if (Test-Path $InputPath) {
    return (Resolve-Path $InputPath).Path
  }

  $cmd = Get-Command $InputPath -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "opencode executable not found: $InputPath"
}

function Get-SqlitePathFromCli {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Exe
  )

  $out = & $Exe db path 2>&1
  if ($LASTEXITCODE -ne 0) {
    $text = ($out | Out-String).Trim()
    throw "Failed to read database path. Output: $text"
  }

  $lines = @($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
  if ($lines.Count -lt 1) {
    throw "db path returned no output"
  }

  return $lines[0]
}

function Set-OpencodeServerEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PgUrl
  )

  $env:OPENCODE_DATABASE_URL = $PgUrl
  $env:OPENCODE_PG_SYNC_BOOTSTRAP = "remote"
  $env:TPCODE_ACCOUNT_ENABLED = "1"
  $env:TPCODE_REGISTER_MODE = "open"
  $env:TPCODE_ACCOUNT_JWT_SECRET = "tpcode-local-dev-secret"
  $env:TPCODE_ADMIN_PASSWORD = "TpCode@2026"
}

