@echo off
setlocal
title AILEXSI Resonance Studio V5.5 — Install / Build / Run
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo Fehler: package.json fehlt. INSTALL_BUILD_RUN_V5.5.cmd muss im V5.5-Repo-Wurzelordner liegen.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Fehler: Node.js wurde nicht gefunden ^(Befehl "node"^).
  echo Bitte Node.js LTS selbst installieren. Dieser Starter laedt keine Installer herunter ^(0 EUR^).
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

where rustc >nul 2>&1
if errorlevel 1 (
  echo Hinweis: rustc fehlt. Tauri-EXE-Build wird fehlschlagen. Vite-Dev ist trotzdem moeglich.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-v5.5-windows.ps1"
if errorlevel 1 (
  echo Build fehlgeschlagen. Starte Dev-Fallback...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v5.5.ps1"
  set "ERR=%ERRORLEVEL%"
  if not "%ERR%"=="0" if not "%ERR%"=="10" pause
  endlocal
  exit /b %ERR%
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
