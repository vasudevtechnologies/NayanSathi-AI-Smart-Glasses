@echo off
title NayanSathi — ngrok Tunnel
color 0B
echo.
echo  =====================================================
echo   NayanSathi — ngrok Public Tunnel
echo   Requires free account at https://ngrok.com
echo  =====================================================
echo.
echo  Make sure your server is running first!
echo  (Run START_SERVER.bat in another window)
echo.
echo  If first time: ngrok config add-authtoken YOUR_TOKEN
echo.
echo  Starting ngrok tunnel on port 3000...
echo  Dashboard: http://localhost:4040
echo.
ngrok http 3000
echo.
echo  Tunnel stopped.
pause
