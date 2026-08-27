@echo off
echo ============================================================
echo   Generate Random Session Secret
echo ============================================================
echo.
python -c "import secrets; print('SESSION_SECRET=' + secrets.token_hex(32))"
echo.
echo Copy the line above into config.env, replace the old SESSION_SECRET line.
echo.
pause
