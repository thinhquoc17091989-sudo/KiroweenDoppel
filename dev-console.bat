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

echo.
echo Starting the Doppel dev console at http://127.0.0.1:5175 ...
echo This is a developer tool for fast local iteration, not the Doppel product itself.
echo Close this window or press Ctrl+C to stop.
echo.
start "" "http://127.0.0.1:5175"
node dev\dev-server.mjs
pause
