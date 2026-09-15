@echo off
setlocal
title AILEXSI Resonance Studio V5.5
rem Startdatei for Resonance Studio V5.5. Prefer INSTALL_BUILD_RUN_V5.5.cmd.
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo Fehler: package.json fehlt. Start-V5.cmd muss im V5.5-Repo-Wurzelordner liegen.
  echo Nicht in ResonanceStudio ^(V4^) starten.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Fehler: Node.js wurde nicht gefunden ^(Befehl "node"^).
  echo Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter ^(0 EUR^).
  echo Kein Download, kein Store, kein kostenpflichtiges Tool.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo Fehler: npm wurde nicht gefunden ^(Befehl "npm"^).
  echo Bitte Node.js LTS ^(enthaelt npm^) selbst installieren. Dieser Starter laedt keine Installer herunter ^(0 EUR^).
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v5.5.ps1"
set "ERR=%ERRORLEVEL%"
if "%ERR%"=="10" (
  echo Bereit: http://127.0.0.1:1421
  pause
  endlocal
  exit /b 0
)
if not "%ERR%"=="0" (
  echo.
  pause
)
endlocal
exit /b %ERR%
