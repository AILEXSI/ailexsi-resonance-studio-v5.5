# AILEXSI Resonance Studio V5 — Windows app launcher helper.
# Called from repo-root Start-V5.cmd. Never cds to V4 (ResonanceStudio).

param(
    [switch]$OpenOnly
)

$ErrorActionPreference = "Stop"
$Url = "http://127.0.0.1:1421"
$WaitSeconds = 30

function Get-V5Root {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here "..")).Path
}

function Test-V5Serving {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Open-V5AppWindow {
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

function Wait-V5Ready {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-V5Serving) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return (Test-V5Serving)
}

if ($OpenOnly) {
    $ready = Wait-V5Ready
    if (-not $ready) {
        Write-Host "Hinweis: $Url hat nach ${WaitSeconds}s nicht geantwortet. Oeffne das Fenster trotzdem."
    }
    Open-V5AppWindow
    exit 0
}

$root = Get-V5Root
Set-Location -LiteralPath $root
try {
    $Host.UI.RawUI.WindowTitle = "AILEXSI Resonance Studio V5"
} catch {
    # non-interactive host
}

Write-Host "AILEXSI Resonance Studio V5"
Write-Host "Ordner: $root"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: Node.js wurde nicht gefunden (Befehl 'node')." -ForegroundColor Red
    Write-Host "Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter (0 EUR)."
    Write-Host "Kein Download, kein Store, kein kostenpflichtiges Tool."
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: npm wurde nicht gefunden (Befehl 'npm')." -ForegroundColor Red
    Write-Host "Bitte Node.js LTS (enthaelt npm) selbst installieren. Dieser Starter laedt keine Installer herunter (0 EUR)."
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    Write-Host "node_modules fehlt — npm install ..."
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Fehler: npm install ist fehlgeschlagen." -ForegroundColor Red
        exit 1
    }
}

if (Test-V5Serving) {
    Write-Host "Port 1421 antwortet bereits. Es wird kein Prozess beendet. Oeffne das App-Fenster."
    Open-V5AppWindow
    Write-Host "Bereit: $Url"
    exit 10
}

Write-Host "Starte Vite (npm run dev) auf $Url ..."
Write-Host "Konsole bleibt offen, damit Vite-Fehler sichtbar sind."
$helper = Join-Path $PSScriptRoot "start-v5.ps1"
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $helper,
    "-OpenOnly"
) | Out-Null

& npm run dev
exit $LASTEXITCODE
