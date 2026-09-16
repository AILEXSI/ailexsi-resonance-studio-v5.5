# Copy the Tauri release exe to the repo root. Does not require the NSIS installer.
# Status lines use single-quoted strings so Windows PowerShell does not
# parse parentheses as expressions.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$product = 'AILEXSI Resonance Studio V5.5'
$release = Join-Path $repo 'src-tauri\target\release'
$dest = Join-Path $repo ($product + '.exe')

$candidates = @(
  (Join-Path $release ($product + '.exe')),
  (Join-Path $release 'ailexsi-resonance-studio-v5-5.exe')
)

$found = $null
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath $c) {
    $found = $c
    break
  }
}

if (-not $found) {
  Write-Error ('Release exe not found under ' + $release + '. Run tauri build first.')
  exit 1
}

Copy-Item -LiteralPath $found -Destination $dest -Force
Write-Host ('Copied: ' + $found)
Write-Host ('To:     ' + $dest)

# STRESS-02 diagnostic maps (present only when AILEXSI_DIAG_SOURCEMAP=1).
$mapSrc = Join-Path $repo 'dist\assets'
$mapDest = Join-Path $repo 'stress-02-sourcemaps'
if (Test-Path -LiteralPath $mapSrc) {
  $maps = Get-ChildItem -LiteralPath $mapSrc -Filter '*.js.map' -ErrorAction SilentlyContinue
  if ($maps) {
    if (-not (Test-Path -LiteralPath $mapDest)) {
      New-Item -ItemType Directory -Path $mapDest | Out-Null
    }
    foreach ($item in $maps) {
      Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $mapDest $item.Name) -Force
    }
    Write-Host ('STRESS-02 sourcemaps: ' + $mapDest)
  }
}

$nsisDir = Join-Path $release 'bundle\nsis'
if (Test-Path -LiteralPath $nsisDir) {
  $nsis = Get-ChildItem -LiteralPath $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue
  if ($nsis) {
    foreach ($item in $nsis) {
      Write-Host ('NSIS installer not copied: ' + $item.FullName)
    }
  } else {
    Write-Host 'NSIS installer: directory exists, no .exe - ok'
  }
} else {
  Write-Host 'NSIS installer: not present - ok'
}
