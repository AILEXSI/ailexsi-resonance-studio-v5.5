# AILEXSI Resonance Studio V5.5 -- Windows app launcher helper.
# Prefers the local V5.5 EXE; otherwise starts Vite on :1421.
# Status lines use single-quoted strings so Windows PowerShell does not
# parse currency text or parentheses as expressions.

param(
    [switch]$OpenOnly
)

$ErrorActionPreference = 'Stop'
$Url = 'http://127.0.0.1:1421'
$WaitSeconds = 30

function Get-V55Root {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here '..')).Path
}

function Test-V55Serving {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Open-V55AppWindow {
    $candidates = @(
        @{ Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; Args = "--app=$Url" },
        @{ Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; Args = "--app=$Url" },
        @{ Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; Args = "--app=$Url" },
        @{ Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; Args = "--app=$Url" },
        @{ Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; Args = "--app=$Url" },
        @{ Path = "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"; Args = "--app=$Url" }
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c.Path) {
            Start-Process -FilePath $c.Path -ArgumentList $c.Args
            return
        }
    }
    Start-Process $Url
}

function Wait-V55Ready {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-V55Serving) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return (Test-V55Serving)
}

$root = Get-V55Root
$exe = Join-Path $root 'AILEXSI Resonance Studio V6.0.exe'
if (Test-Path -LiteralPath $exe) {
    Write-Host ('Starte EXE: ' + $exe)
    Start-Process -FilePath $exe
    exit 0
}

if ($OpenOnly) {
    $ready = Wait-V55Ready
    if (-not $ready) {
        Write-Host ('Hinweis: ' + $Url + ' hat nach ' + $WaitSeconds + 's nicht geantwortet. Oeffne das Fenster trotzdem.')
    }
    Open-V55AppWindow
    exit 0
}

Set-Location -LiteralPath $root
try {
    $Host.UI.RawUI.WindowTitle = 'AILEXSI Resonance Studio V6.0'
} catch {
    # non-interactive host
}

Write-Host 'AILEXSI Resonance Studio V6.0'
Write-Host ('Ordner: ' + $root)
Write-Host 'Keine lokale EXE - starte Vite Dev.'
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
    Write-Host 'node_modules fehlt - npm install ...'
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Fehler: npm install ist fehlgeschlagen.' -ForegroundColor Red
        exit 1
    }
}

if (Test-V55Serving) {
    Write-Host 'Port 1421 antwortet bereits. Es wird kein Prozess beendet. Oeffne das App-Fenster.'
    Open-V55AppWindow
    Write-Host ('Bereit: ' + $Url)
    exit 10
}

Write-Host ('Starte Vite - npm run web:dev - auf ' + $Url + ' ...')
$helper = Join-Path $PSScriptRoot 'run-v5.5.ps1'
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $helper,
    '-OpenOnly'
) | Out-Null

& npm run web:dev
exit $LASTEXITCODE
