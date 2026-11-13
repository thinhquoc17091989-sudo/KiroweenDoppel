@echo off
setlocal
cd /d "%~dp0"
title Doppel dev console

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node 20 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting the Doppel dev console at http://localhost:5173/dev/console.html ...
echo This is a developer tool for fast local iteration, not the Doppel product itself.
echo The product's own review page (run-doppel.bat) is the SAME server, at /index.html --
echo if run-doppel.bat is already running, this will fail to bind the port: just open
echo http://localhost:5173/dev/console.html in that already-running tab instead.
echo Close this window or press Ctrl+C to stop.
echo.
start "" "http://localhost:5173/dev/console.html"
call npm run dev -- --port 5173 --strictPort
pause
