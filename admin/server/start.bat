@echo off

cd /d "%~dp0"

echo ============================================================
echo   Qingbu Feedback Admin - Start
echo ============================================================
echo.

if not exist "config.env" goto :no_config
where python >nul 2>nul
if errorlevel 1 goto :no_python

echo [1/4] Loading config...
copy /y "config.env" ".env" >nul
if errorlevel 1 goto :copy_fail

if not exist "venv\Scripts\activate.bat" goto :no_venv

call "venv\Scripts\activate.bat"
if errorlevel 1 goto :activate_fail

if exist "venv\.deps_installed" goto :deps_ok

echo [3/4] Installing dependencies, please wait about 30 seconds...
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 goto :deps_fail
echo done> "venv\.deps_installed"
echo Done.

:deps_ok
echo [4/4] Starting server...
echo.
echo ============================================================
echo   Server started.
echo   Open in browser: http://127.0.0.1:5000
echo   Login with the username and password in config.env
echo   Close this window to stop the server.
echo ============================================================
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:5000"

python app.py
echo.
echo Server stopped.
goto :end

:no_config
echo [ERROR] config.env not found. Please edit admin\server\config.env first.
goto :end

:no_python
echo [ERROR] Python not found. Please install Python 3.8+ and check Add Python to PATH.
goto :end

:copy_fail
echo [ERROR] Failed to copy config.env to .env
goto :end

:no_venv
echo [ERROR] venv not found or broken. Run reset.bat first, then run start.bat.
goto :end

:activate_fail
echo [ERROR] Failed to activate venv.
goto :end

:deps_fail
echo [ERROR] Failed to install dependencies.

:end
echo.
pause
