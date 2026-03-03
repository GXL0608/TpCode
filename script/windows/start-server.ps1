param(
  [string]$OpencodeExe = "opencode.exe",
  [int]$Port = 4096,
  [string]$PgUrl = "postgres://opencode:opencode@182.92.74.187:9124/opencode",
  [switch]$Foreground
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_shared.ps1")

$exe = Resolve-OpencodeExe -InputPath $OpencodeExe
Set-OpencodeServerEnv -PgUrl $PgUrl

if ($Foreground) {
  & $exe serve --port $Port --print-logs
  exit $LASTEXITCODE
}

$base = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "opencode" } else { Join-Path $env:TEMP "opencode" }
$runDir = Join-Path $base "run"
$logDir = Join-Path $base "logs"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$outLog = Join-Path $logDir "opencode-$Port.out.log"
$errLog = Join-Path $logDir "opencode-$Port.err.log"
$pidFile = Join-Path $runDir "opencode-$Port.pid"

$proc = Start-Process `
  -FilePath $exe `
  -ArgumentList @("serve", "--port", "$Port", "--print-logs") `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

$proc.Id | Set-Content -Path $pidFile -Encoding ASCII

$health = "http://127.0.0.1:$Port/global/health"
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) {
    throw "Server exited early. Check logs: $outLog , $errLog"
  }
  try {
    $null = Invoke-RestMethod -Uri $health -Method Get -TimeoutSec 2
    $ok = $true
    break
  }
  catch {
  }
}

if (!$ok) {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  throw "Server health check failed: $health"
}

Write-Host "Server started."
Write-Host "  PID:      $($proc.Id)"
Write-Host "  Health:   $health"
Write-Host "  PID file: $pidFile"
Write-Host "  Logs:     $outLog"
