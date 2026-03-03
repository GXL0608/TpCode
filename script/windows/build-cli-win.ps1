param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$Baseline,
  [switch]$SkipInstall,
  [switch]$SkipWebBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $RepoRoot
try {
  $args = @("--cwd", "packages/opencode", "run", "script/build.ts", "--single")
  if ($Baseline) { $args += "--baseline" }
  if ($SkipInstall) { $args += "--skip-install" }
  if ($SkipWebBuild) { $args += "--skip-web-build" }

  & bun @args
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE"
  }

  $name = if ($Baseline) { "opencode-windows-x64-baseline" } else { "opencode-windows-x64" }
  $dist = Join-Path $RepoRoot "packages\opencode\dist\$name"
  $exe = Join-Path $dist "bin\opencode.exe"
  if (!(Test-Path $exe)) {
    throw "Built executable not found: $exe"
  }

  $zip = Join-Path $RepoRoot "packages\opencode\dist\$name.zip"
  if (Test-Path $zip) {
    Remove-Item -Path $zip -Force
  }
  Compress-Archive -Path (Join-Path $dist "bin\*") -DestinationPath $zip -Force

  Write-Host "Build OK: $exe"
  Write-Host "Zip OK:   $zip"
}
finally {
  Pop-Location
}
