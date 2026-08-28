@echo off
cd /d "%~dp0"
echo.
echo === Sigma GMaps - start limpo ===
echo Matando processos Electron / Sigma antigos...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "Sigma GMaps Scraper.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo Limpando pastas TEMP sigma-ui-* ...
for /d %%D in ("%LOCALAPPDATA%\Temp\sigma-ui-*") do rd /s /q "%%D" 2>nul

echo Rebuild da interface...
call npm run build:renderer
if errorlevel 1 (
  echo FALHA no build da UI
  pause
  exit /b 1
)

echo.
echo Nao abra dist\win-unpacked\*.exe  -- use este script ou npm start
echo Abrindo app com UI nova...
call npx electron .
