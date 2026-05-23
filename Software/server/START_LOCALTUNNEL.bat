@echo off
title NayanSathi — LocalTunnel
color 0E
echo.
echo  =====================================================
echo   NayanSathi — LocalTunnel (via npx)
echo   FREE * No install * No account needed
echo  =====================================================
echo.
echo  Make sure your server is running first!
echo  (Run START_SERVER.bat in another window)
echo.
echo  Starting LocalTunnel on port 3000...
echo.
npx -y localtunnel --port 3000
echo.
echo  Tunnel stopped.
pause
