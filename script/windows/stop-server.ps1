param(
  [string]$OpencodeExe = "opencode.exe",
  [int]$Port = 4096
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$base = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "opencode" } else { Join-Path $env:TEMP "opencode" }
$runDir = Join-Path $base "run"
$pidFile = Join-Path $runDir "opencode-$Port.pid"
$stopped = 0

if (Test-Path $pidFile) {
  $pidRaw = (Get-Content -Path $pidFile -Raw).Trim()
  if ($pidRaw -match "^\d+$") {
    $pidValue = [int]$pidRaw
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      $stopped += 1
    }
  }
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

$name = [System.IO.Path]::GetFileName($OpencodeExe)
if ([string]::IsNullOrWhiteSpace($name)) {
  $name = "opencode.exe"
}

$procs = Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object {
  $_.CommandLine -match "(^|\s)serve(\s|$)" -and $_.CommandLine -match "--port\s+$Port(\s|$)"
}

foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  $stopped += 1
}

# Compatibility: previous deployments may run through bun instead of opencode.exe.
$bunProcs = Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | Where-Object {
  $_.CommandLine -match "(^|\s)serve(\s|$)" -and
  $_.CommandLine -match "--port\s+$Port(\s|$)" -and
  $_.CommandLine -match "packages[\\/ ]opencode"
}

foreach ($p in $bunProcs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  $stopped += 1
}

Write-Host "Stopped $stopped process(es) on port $Port."
