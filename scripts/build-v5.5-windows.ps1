# AILEXSI Resonance Studio V5.5 -- Windows install + Tauri EXE build.
# Called from repo-root INSTALL_BUILD_RUN_V5.5.cmd / BUILD_AND_RUN_V5.5.cmd.
# Status lines use single-quoted strings so Windows PowerShell does not
# parse currency text or parentheses as expressions.
# npm is always npm.cmd via cmd.exe /c. Never a bare npm alias/function
# (Windows PowerShell can split that to n + pm -> Unknown command: "pm").

$ErrorActionPreference = 'Stop'

function Get-V55Root {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here '..')).Path
}

function Resolve-NpmCmd {
    # Prefer an explicit path from the .cmd launcher, then npm.cmd beside
    # node.exe, then PATH npm.cmd. Never Get-Command npm (alias / npm.ps1).
    $fromEnv = $env:NPM_CMD
    if ($fromEnv -and (Test-Path -LiteralPath $fromEnv)) {
        $leaf = [System.IO.Path]::GetFileName($fromEnv)
        if ($leaf -ieq 'npm.cmd') {
            return (Resolve-Path -LiteralPath $fromEnv).Path
        }
    }

    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($node -and $node.Source) {
        $beside = Join-Path (Split-Path -Parent $node.Source) 'npm.cmd'
        if (Test-Path -LiteralPath $beside) {
            return (Resolve-Path -LiteralPath $beside).Path
        }
    }

    $found = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
    if ($found -and $found.Source -and (Test-Path -LiteralPath $found.Source)) {
        return $found.Source
    }

    $whereOut = & where.exe npm.cmd 2>$null
    if ($whereOut) {
        $first = @($whereOut)[0]
        if ($first -and (Test-Path -LiteralPath $first)) {
            return $first
        }
    }

    return $null
}

function Invoke-NpmCmd {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$NpmArgs
    )

    if (-not $script:NpmCmdPath) {
        Write-Host 'Fehler: npm.cmd wurde nicht gefunden. Befehl: npm.cmd' -ForegroundColor Red
        exit 1
    }

    $quotedArgs = New-Object System.Collections.Generic.List[string]
    foreach ($a in $NpmArgs) {
        if ($null -eq $a) { continue }
        if ($a -match '[\s&|<>^"]') {
            [void]$quotedArgs.Add(('"' + ($a -replace '"', '""') + '"'))
        } else {
            [void]$quotedArgs.Add($a)
        }
    }

    # call so .cmd errorlevel is returned to this cmd.exe /c process.
    $line = 'call "' + $script:NpmCmdPath + '"'
    if ($quotedArgs.Count -gt 0) {
        $line = $line + ' ' + ($quotedArgs -join ' ')
    }

    & cmd.exe /c $line
    return $LASTEXITCODE
}

$root = Get-V55Root
Set-Location -LiteralPath $root

Write-Host 'AILEXSI Resonance Studio V5.5 - Windows build'
Write-Host ('Ordner: ' + $root)
Write-Host ''

if (-not (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Fehler: Node.js wurde nicht gefunden. Befehl: node' -ForegroundColor Red
    Write-Host 'Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.'
    exit 1
}

$script:NpmCmdPath = Resolve-NpmCmd
if (-not $script:NpmCmdPath) {
    Write-Host 'Fehler: npm.cmd wurde nicht gefunden. Befehl: npm.cmd' -ForegroundColor Red
    Write-Host 'Bitte Node.js LTS, enthaelt npm, selbst installieren. Dieser Starter laedt keine Installer herunter. Kosten: 0 EUR.'
    exit 1
}
Write-Host ('npm.cmd: ' + $script:NpmCmdPath)

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host 'node_modules fehlt - npm ci ...'
    $code = Invoke-NpmCmd -NpmArgs @('ci')
    if ($code -ne 0) {
        Write-Host 'npm ci fehlgeschlagen, versuche npm install ...'
        $code = Invoke-NpmCmd -NpmArgs @('install')
        if ($code -ne 0) {
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
$code = Invoke-NpmCmd -NpmArgs @('run', 'tauri:exe')
if ($code -ne 0) {
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
