@echo off
REM PolyHeart launcher — serves the game on http://localhost:8420
cd /d "%~dp0"
echo Starting PolyHeart at http://localhost:8420 ...
start "" http://localhost:8420
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8420
) else (
  npx -y http-server -p 8420 -c-1
)
