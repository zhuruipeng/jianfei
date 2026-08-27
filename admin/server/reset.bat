@echo off
setlocal

echo ============================================================
echo   Reset Environment (delete venv and .env)
echo ============================================================
echo.
echo This will delete the virtual environment. Dependencies need
echo to be reinstalled (~30s). Your config.env will NOT be deleted.
echo.
pause

cd /d "%~dp0"

if exist "venv" (
  echo Deleting venv...
  rmdir /s /q "venv"
  echo Done.
) else (
  echo venv not found, skip.
)

if exist ".env" del /q ".env"
if exist "venv\.deps_installed" del /q "venv\.deps_installed"

echo.
echo ============================================================
echo   Reset complete!
echo   Now double-click start.bat to start again.
echo ============================================================
pause
