@echo off
title NayanSathi — Cloudflare Public Tunnel
color 0A
echo.
echo  =====================================================
echo   NayanSathi — Cloudflare Tunnel (NO account needed)
echo   Your dashboard will be public in ~5 seconds!
echo  =====================================================
echo.
echo  Starting tunnel on http://localhost:3000 ...
echo  Look for the https://....trycloudflare.com URL below
echo.
cd /d "%~dp0"
cloudflared.exe tunnel --url http://localhost:3000
echo.
pause
