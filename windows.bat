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
set TTS_PHONEMIZER=%APP%\tts-runtime\node_modules\@echogarden\espeak-ng-emscripten
set SERVE=%~dp0scripts\server\serve.cjs
if "%FRONTEND_PORT%"=="" set FRONTEND_PORT=1420
if "%LLM_PORT%"=="" set LLM_PORT=10086
set SETUP_REASON=
set SETUP_MODE=Ripristino dei componenti

:: -- First-time setup check ----------------------------------------------------
if not exist "%APP%\tools\node-win" set SETUP_MODE=Prima preparazione
if not exist "%NODE%" (
    set SETUP_REASON=Manca Node.js, il programma che esegue i servizi locali.
    goto :run_setup
)
if not exist "%NPM%" (
    set SETUP_REASON=Manca npm, lo strumento che prepara i componenti dell'app.
    goto :run_setup
)
if not exist "%DIST%" (
    set SETUP_REASON=Manca l'interfaccia pronta da aprire nel browser.
    goto :run_setup
)
if not exist "%LLM_CPU_BACKEND%" (
    set SETUP_REASON=Manca llama.cpp, il motore che esegue la chat sul processore.
    goto :run_setup
)
if not exist "%SPEECH_BACKEND%" (
    set SETUP_REASON=Manca Whisper, il motore che trasforma le registrazioni in testo.
    goto :run_setup
)
if not exist "%TTS_PHONEMIZER%" (
    set SETUP_REASON=Manca il componente per la pronuncia italiana.
    goto :run_setup
)
if not exist "%TTS_RUNTIME%" (
    set SETUP_REASON=Manca Kokoro, il motore che legge i testi ad alta voce.
    goto :run_setup
)

goto :launch

:run_setup
echo.
echo  ============================================================
echo   LOCAL STUDIO SCUOLA      ^|  %SETUP_MODE%
echo  ============================================================
echo.
if "%SETUP_MODE%"=="Prima preparazione" (
    echo  Questa cartella deve essere preparata prima di usare l'app.
) else (
    echo  Prima di avviare l'app occorre completare alcuni componenti.
)
if not "%SETUP_REASON%"=="" echo  Motivo: %SETUP_REASON%
echo  Collega il PC a Internet e lascia aperta questa finestra.
echo  Il programma prepara gli strumenti nella cartella app.
echo  Il primo avvio puo' richiedere diversi minuti: attendi i messaggi.
echo  Windows potrebbe chiedere al docente i permessi di amministratore
echo  per il componente Microsoft Visual C++.
echo  I modelli AI si scaricano dopo, dalla sezione Modelli dell'app.
echo  Non servono account, chiavi API o abbonamenti a pagamento.
echo.
echo  Premi un tasto per iniziare la preparazione, oppure Ctrl+C per annullare.
pause >nul

:: Clear old managed backend processes before setup so app/tools/node-win can be replaced.
:: Do not kill the frontend port; launch will select a free frontend port automatically.

powershell -ExecutionPolicy Bypass -File "%SETUP%"
if errorlevel 1 (
    echo.
    echo  [ERRORE] Preparazione non completata. Leggi il messaggio qui sopra.
    echo  Controlla Internet e mostra l'errore al docente; poi riprova windows.bat.
    echo  Premi un tasto per chiudere questa finestra.
    pause >nul
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
echo   LOCAL STUDIO SCUOLA      ^|  Avvio dell'app
echo  ============================================================
echo.

set "REQUESTED_FRONTEND_PORT=%FRONTEND_PORT%"
call :resolve_frontend_port
if errorlevel 1 exit /b 1
if not "%FRONTEND_PORT%"=="%REQUESTED_FRONTEND_PORT%" echo  L'indirizzo locale sulla porta %REQUESTED_FRONTEND_PORT% e' occupato; uso %FRONTEND_PORT%.

:: Clear managed backend ports to prevent stale API conflicts.


:: Start the local CPU services
echo  Avvio dei servizi sul tuo PC: i modelli usano la CPU, senza GPU dedicata.
echo  Tra pochi secondi si apre il browser su http://localhost:%FRONTEND_PORT%
echo  localhost indica questo computer: non e' un servizio cloud.
echo  Se la pagina non appare subito, attendi e ricaricala.
start /b cmd /c "timeout /t 2 >nul && start http://localhost:%FRONTEND_PORT%"

echo.
echo  ============================================================
echo   COME INIZIARE
echo   1. Apri http://localhost:%FRONTEND_PORT% nel browser.
echo   2. In Modelli, sezione Chat, scarica Qwen 2.5 0.5B Instruct.
echo     Un modello contiene i dati appresi dall'AI durante l'addestramento.
echo     Scaricarlo non significa addestrarlo: serve per eseguirlo sul PC.
echo     Se e' gia' presente, selezionalo e caricalo.
echo   3. Torna alla Chat e scrivi una domanda breve. La risposta puo' sbagliare.
echo     Confrontala con le fonti e con le indicazioni del docente.
echo   4. Per trascrivere un audio prepara Whisper Tiny multilingue.
echo     Per leggere un testo prepara Kokoro Q8 e scegli Sara o Nicola.
echo     Prova entrambe le voci con Internet prima della lezione offline.
echo  Dopo i download puoi lavorare senza Internet.
echo  Chat e audio si alternano per risparmiare memoria: attendi la fine.
echo  Dopo un'attivita' audio, ricarica il modello per tornare alla chat.
echo.
echo   Lascia aperta questa finestra mentre usi l'app.
echo  Per terminare premi Ctrl+C qui; se Windows chiede conferma, conferma.
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

echo  [ERRORE] Nessuna porta locale libera: provate %FRONTEND_PORT% e 1421-1499.
echo  Chiudi le altre istanze di Local Studio e riavvia windows.bat.
echo  Se il problema continua, mostra questo messaggio al docente.
echo  Premi un tasto per chiudere.
pause >nul
exit /b 1

:is_port_available
set "PORT_AVAILABLE=1"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%~1 " ^| findstr /I "LISTENING"') do (
    set "PORT_AVAILABLE=0"
)
exit /b 0
