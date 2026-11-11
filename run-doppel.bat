@echo off
setlocal
cd /d "%~dp0"
title Doppel

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
echo Starting Doppel at http://localhost:5173 ...
echo Close this window or press Ctrl+C to stop.
echo.
start "" "http://localhost:5173"
call npm run dev -- --port 5173 --strictPort
pause
