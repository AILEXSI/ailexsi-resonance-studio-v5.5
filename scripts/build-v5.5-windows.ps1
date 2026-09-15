# AILEXSI Resonance Studio V5.5 -- Windows install + Tauri EXE build.
# Called from repo-root INSTALL_BUILD_RUN_V5.5.cmd / BUILD_AND_RUN_V5.5.cmd.
# Status lines use single-quoted strings so Windows PowerShell does not
# parse currency text or parentheses as expressions.

$ErrorActionPreference = 'Stop'

function Get-V55Root {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here '..')).Path
}

$root = Get-V55Root
Set-Location -LiteralPath $root

Write-Host 'AILEXSI Resonance Studio V5.5 - Windows build'
Write-Host ('Ordner: ' + $root)
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Fehler: Node.js wurde nicht gefunden. Befehl: node' -ForegroundColor Red
    Write-Host 'Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.'
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'Fehler: npm wurde nicht gefunden. Befehl: npm' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host 'node_modules fehlt - npm ci ...'
    & npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'npm ci fehlgeschlagen, versuche npm install ...'
        & npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Fehler: npm install ist fehlgeschlagen.' -ForegroundColor Red
            exit 1
        }
    }
}

if (-not (Get-Command rustc -ErrorAction SilentlyContinue) -or -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host 'Fehler: Rust/cargo fehlt. Tauri EXE kann hier nicht gebaut werden.' -ForegroundColor Red
    Write-Host 'Install rustup from https://rustup.rs then re-run. Kein Download durch dieses Skript.'
    exit 1
}

Write-Host 'npm run tauri:exe ...'
& npm run tauri:exe
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Fehler: tauri:exe ist fehlgeschlagen.' -ForegroundColor Red
    exit 1
}

$exe = Join-Path $root 'AILEXSI Resonance Studio V5.5.exe'
if (Test-Path -LiteralPath $exe) {
    Write-Host ('EXE: ' + $exe)
} else {
    Write-Host 'Hinweis: Root-EXE noch nicht kopiert. Siehe src-tauri\target\release\'
}
exit 0
