@echo off
title Facades Pollet - Services Locaux
echo.
echo  ========================================
echo   Facades Pollet - Demarrage des services
echo  ========================================
echo.

:: Computer Use Server
echo [1/2] Demarrage du serveur Computer Use (port 3003)...
start "Computer Use Server" cmd /k "cd /d %~dp0 && node computer-use-server.js"

:: Tunnel Cloudflare
echo [2/2] Demarrage du tunnel Cloudflare...
start "Tunnel Cloudflare" cmd /k "cloudflared tunnel run facades-pollet"

echo.
echo  Tous les services sont demarres !
echo  - Computer Use : http://localhost:3003
echo  - Tunnel : facades-pollet via Cloudflare
echo.
echo  Fermez cette fenetre pour arreter tous les services.
pause
