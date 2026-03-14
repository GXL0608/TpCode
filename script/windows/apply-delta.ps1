param(
  [Parameter(Mandatory = $true)]
  [string]$DeltaPath,
  [Parameter(Mandatory = $true)]
  [string]$TargetRoot,
  [string]$BackupRoot = "",
  [switch]$NoBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Copy-Tree {
  param(
    [string]$SourceRoot,
    [string]$TargetRoot,
    [string]$BackupDir
  )

  if (-not (Test-Path $SourceRoot)) {
    return
  }

  Get-ChildItem -Path $SourceRoot -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($SourceRoot.Length).TrimStart('\', '/')
    $target = Join-Path $TargetRoot $rel
    $parent = Split-Path -Path $target -Parent
    if (-not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if ($BackupDir -and (Test-Path $target)) {
      $backup = Join-Path $BackupDir $rel
      $backupParent = Split-Path -Path $backup -Parent
      if (-not (Test-Path $backupParent)) {
        New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
      }
      Copy-Item -Path $target -Destination $backup -Force
    }

    Copy-Item -Path $_.FullName -Destination $target -Force
  }
}

$delta = (Resolve-Path $DeltaPath).Path
if (-not (Test-Path $delta)) {
  throw "Delta path not found: $DeltaPath"
}

if ($delta.EndsWith(".zip")) {
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("tpcode-delta-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  Expand-Archive -Path $delta -DestinationPath $temp -Force
  $delta = $temp
}

if (-not (Test-Path $TargetRoot)) {
  New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
}

$target = (Resolve-Path $TargetRoot).Path
$manifest = Join-Path $delta "manifest.json"
$removeFile = Join-Path $delta "remove.txt"
$addRoot = Join-Path $delta "add"
$replaceRoot = Join-Path $delta "replace"

if (-not (Test-Path $manifest)) {
  throw "manifest.json not found under $delta"
}

$backupDir = ""
if (-not $NoBackup) {
  if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path $target ".delta-backups"
  }
  if (-not (Test-Path $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  }
  $backupDir = Join-Path $BackupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  Copy-Item -Path $manifest -Destination (Join-Path $backupDir "manifest.json") -Force
}

if (Test-Path $removeFile) {
  Get-Content $removeFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    $rel = $_.Trim()
    $item = Join-Path $target $rel
    if (-not (Test-Path $item)) {
      return
    }

    if ($backupDir) {
      $backup = Join-Path $backupDir $rel
      $parent = Split-Path -Path $backup -Parent
      if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }
      if ((Get-Item $item).PSIsContainer) {
        Copy-Item -Path $item -Destination $backup -Recurse -Force
      } else {
        Copy-Item -Path $item -Destination $backup -Force
      }
    }

    Remove-Item -Path $item -Recurse -Force
  }
}

Copy-Tree -SourceRoot $addRoot -TargetRoot $target -BackupDir $backupDir
Copy-Tree -SourceRoot $replaceRoot -TargetRoot $target -BackupDir $backupDir

Write-Host "Delta applied."
Write-Host "Target: $target"
if ($backupDir) {
  Write-Host "Backup: $backupDir"
}
