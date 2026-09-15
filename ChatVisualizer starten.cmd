@echo off
rem ChatVisualizer starten - einfach doppelklicken.
rem Braucht nichts ausser Windows-Bordmitteln (PowerShell ist ueberall dabei).

title ChatVisualizer
cd /d "%~dp0"

if not exist "%~dp0index.html" (
  echo.
  echo   index.html wurde nicht gefunden.
  echo   Diese Datei muss im selben Ordner wie index.html liegen.
  echo.
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 goto keinpowershell

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if "%errorlevel%"=="3" goto direkt
exit /b 0

:keinpowershell
echo.
echo   PowerShell wurde nicht gefunden.

:direkt
echo.
echo   Der lokale Server konnte nicht gestartet werden.
echo   ChatVisualizer wird stattdessen direkt geoeffnet.
echo.
echo   Hinweis: In diesem Modus speichern manche Browser die importierten
echo   Chats nicht dauerhaft - nach dem Schliessen sind sie ggf. weg.
echo.
start "" "%~dp0index.html"
pause
exit /b 0
