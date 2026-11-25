@echo off
title Expo Snack Cloner Studio
cd /d "%~dp0"
echo Iniciando Expo Snack Cloner Studio...
start "" "http://localhost:3456"
node local-server.mjs
pause
