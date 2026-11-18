@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Local Studio Scuola
cd /d "%~dp0"

set APP=%~dp0app
set NODE=%APP%\tools\node-win\node.exe
set NPM=%APP%\tools\node-win\npm.cmd
set DIST=%APP%\dist\index.html
set SETUP=%~dp0scripts\setup\setup.ps1
set LLM_CPU_BACKEND=%APP%\llm-backend\win\cpu\llama-server.exe
set SPEECH_BACKEND=%APP%\speech-backend\win\cpu\whisper-cli.exe
set TTS_RUNTIME=%APP%\tts-runtime\node_modules\kokoro-js
set SERVE=%~dp0scripts\server\serve.cjs
if "%FRONTEND_PORT%"=="" set FRONTEND_PORT=1420
if "%LLM_PORT%"=="" set LLM_PORT=10086
set SETUP_REASON=
set SETUP_MODE=Repair

:: -- First-time setup check ----------------------------------------------------
if not exist "%APP%\tools\node-win" set SETUP_MODE=First-Time Setup
if not exist "%NODE%" (
    set SETUP_REASON=Portable Node.js is missing.
    goto :run_setup
)
if not exist "%NPM%" (
    set SETUP_REASON=Portable npm is missing.
    goto :run_setup
)
if not exist "%DIST%" (
    set SETUP_REASON=Frontend build is missing.
    goto :run_setup
)
if not exist "%LLM_CPU_BACKEND%" (
    set SETUP_REASON=llama.cpp text backend is missing.
    goto :run_setup
)
if not exist "%SPEECH_BACKEND%" (
    set SETUP_REASON=whisper.cpp speech backend is missing.
    goto :run_setup
)
if not exist "%TTS_RUNTIME%" (
    set SETUP_REASON=Kokoro text-to-speech runtime is missing.
    goto :run_setup
)

goto :launch

:run_setup
echo.
echo  ============================================================
echo   LOCAL STUDIO SCUOLA      ^|  %SETUP_MODE%
echo  ============================================================
echo.
if "%SETUP_MODE%"=="First-Time Setup" (
    echo  This looks like your first run. Setting up automatically...
) else (
    echo  Local Studio Scuola needs a quick repair before launch.
)
if not "%SETUP_REASON%"=="" echo  Reason: %SETUP_REASON%
echo  Models are not downloaded during setup. Download or import them in the app.
echo.
echo  Press any key to continue, or Ctrl+C to cancel.
pause >nul

:: Clear old managed backend processes before setup so app/tools/node-win can be replaced.
:: Do not kill the frontend port; launch will select a free frontend port automatically.

powershell -ExecutionPolicy Bypass -File "%SETUP%"
if errorlevel 1 (
    echo.
    echo  [ERROR] Setup failed. Please check the output above.
    pause
    exit /b 1
)

:: After setup, continue to launch
goto :launch

:: -- Launch -------------------------------------------------------------------
:launch
:: Keep the llama.cpp backend on the pinned release (existing installs never re-run setup).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup\update-llama.ps1"
echo.
echo  ============================================================
echo   LOCAL STUDIO SCUOLA      ^|  Launching...
echo  ============================================================
echo.

set "REQUESTED_FRONTEND_PORT=%FRONTEND_PORT%"
call :resolve_frontend_port
if errorlevel 1 exit /b 1
if not "%FRONTEND_PORT%"=="%REQUESTED_FRONTEND_PORT%" echo  Frontend port %REQUESTED_FRONTEND_PORT% is busy; using %FRONTEND_PORT% instead.

:: Clear managed backend ports to prevent stale API conflicts.


:: Start the local CPU services
echo  Starting Local Studio Scuola...
echo  Opening browser at http://localhost:%FRONTEND_PORT%...
start /b cmd /c "timeout /t 2 >nul && start http://localhost:%FRONTEND_PORT%"

echo.
echo  ============================================================
echo   Running!
echo   Web UI:     http://localhost:%FRONTEND_PORT%
echo   Text API:   Starts when a GGUF model is loaded (port %LLM_PORT%)
echo   Speech:     Managed locally by the app
echo   TTS:        Managed locally by the app
echo.
echo   Press Ctrl+C in this window to stop all services.
echo  ============================================================
echo.

"%NODE%" "%SERVE%"
exit /b %ERRORLEVEL%

:resolve_frontend_port
call :is_port_available "%FRONTEND_PORT%"
if "%PORT_AVAILABLE%"=="1" exit /b 0

for /L %%p in (1421,1,1499) do (
    if not "%%p"=="%FRONTEND_PORT%" (
        call :is_port_available "%%p"
        if "!PORT_AVAILABLE!"=="1" (
            set "FRONTEND_PORT=%%p"
            exit /b 0
        )
    )
)

echo  [ERROR] No free frontend port found. Tried %FRONTEND_PORT% and 1421-1499.
exit /b 1

:is_port_available
set "PORT_AVAILABLE=1"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%~1 " ^| findstr /I "LISTENING"') do (
    set "PORT_AVAILABLE=0"
)
exit /b 0
