@echo off
cd /d %~dp0

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this machine.
  echo Opening the Node.js download page...
  start "" "https://nodejs.org/"
  echo.
  set /p _continue=Install Node.js, then press Enter here to continue...
  where node >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Node.js is still not available on PATH.
    echo Close this window, finish the Node.js install, then run install.bat again.
    exit /b 1
  )
)

if not exist node_modules (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

node install.js
