param(
  [switch]$NoSyncVersion
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Building Serial Helper release from $root"

if (-not $NoSyncVersion) {
  Write-Host "Syncing version metadata..."
  Push-Location $root
  try {
    npm run sync:version
  } finally {
    Pop-Location
  }
}

Write-Host "Installing dependencies if needed..."
Push-Location $root
try {
  npm install
  Write-Host "Running frontend build..."
  npm run build
  Write-Host "Building Tauri bundle..."
  npm run tauri -- build
} finally {
  Pop-Location
}

Write-Host "Release build complete."
