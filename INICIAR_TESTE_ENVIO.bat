@echo off
setlocal
powershell.exe -NoLogo -NoProfile -File "%~dp0INICIAR_TESTE_ENVIO.ps1" %*
set "starter_exit=%ERRORLEVEL%"
if not "%starter_exit%"=="0" pause
exit /b %starter_exit%
