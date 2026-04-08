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

:: Wait for server to start
timeout /t 3 /nobreak >nul

:: Tunnel Cloudflare (Quick Tunnel - pas besoin de config)
echo [2/2] Demarrage du tunnel Cloudflare...
start "Tunnel Cloudflare" cmd /k "cloudflared tunnel --url http://localhost:3003"

echo.
echo  Tous les services sont demarres !
echo  - Computer Use : http://localhost:3003
echo  - Tunnel : voir l'URL dans la fenetre Cloudflare
echo.
echo  IMPORTANT : copiez l'URL du tunnel (https://xxx.trycloudflare.com)
echo  et mettez-la dans Vercel (Settings - Environment Variables - TUNNEL_URL)
echo.
pause
