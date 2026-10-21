@echo off
title The Imposter server
cd /d "%~dp0"
start "The Imposter server" /MIN cmd /c "node server.js"
timeout /t 1 >nul
start "" http://localhost:3000
echo.
echo  The game server is running in a minimized window.
echo  Players on your WiFi can visit: check your laptop IP, port 3000
echo.
echo  Close the minimized "The Imposter server" window to stop the game.
pause
