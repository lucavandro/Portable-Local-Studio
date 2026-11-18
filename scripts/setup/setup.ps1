# Local Studio - Setup Script
# scripts/setup/ lives under root, app/ is a root sibling of scripts/

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir     = Split-Path -Parent (Split-Path -Parent $scriptDir)
$appDir      = Join-Path $rootDir "app"
$frontendDir = Join-Path $appDir  "frontend"
$toolsDir    = Join-Path $appDir  "tools"
$nodeDir     = Join-Path $toolsDir "node-win"
$nodeExe     = Join-Path $nodeDir  "node.exe"
$npmCmd      = Join-Path $nodeDir  "npm.cmd"
$distDir     = Join-Path $appDir   "dist"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Print-Header {
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host "   LOCAL STUDIO - SCUOLA      -  Preparazione dei componenti" -ForegroundColor Cyan
    Write-Host "   Componenti nella cartella app | Visual C++ puo' richiedere permessi" -ForegroundColor DarkCyan
    Write-Host "  ============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Print-Step {
    param([int]$n, [int]$total, [string]$title)
    Write-Host ""
    Write-Host "  [$n/$total] $title" -ForegroundColor White
    Write-Host ("  " + "-" * 56) -ForegroundColor DarkGray
}

function Print-OK   { param([string]$m); Write-Host "   OK  $m" -ForegroundColor Green }
function Print-Info { param([string]$m); Write-Host "   >>  $m" -ForegroundColor Cyan }
function Print-Warn { param([string]$m); Write-Host "   !!  $m" -ForegroundColor Yellow }
function Print-Fail { param([string]$m); Write-Host "   XX  $m" -ForegroundColor Red }

function Format-Bytes {
    param([long]$b)
    if ($b -gt 1GB) { return "{0:N2} GB" -f ($b / 1GB) }
    if ($b -gt 1MB) { return "{0:N1} MB" -f ($b / 1MB) }
    return "{0:N0} KB" -f ($b / 1KB)
}

function Format-Speed {
    param([double]$bps)
    if ($bps -gt 1MB) { return "{0:N1} MB/s" -f ($bps / 1MB) }
    return "{0:N0} KB/s" -f ($bps / 1KB)
}

function Enable-Tls12 {
    try {
        # Use the protocol's numeric value because older .NET enum definitions
        # do not expose the Tls12 member even when Windows supports TLS 1.2.
        $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    } catch {
        throw "Impossibile attivare la connessione sicura TLS 1.2. La preparazione richiede Windows 10 o 11 a 64 bit aggiornato. $($_.Exception.Message)"
    }
}

function Invoke-RichDownload {
    param([string]$Url, [string]$Dest, [string]$Label)
    Print-Info "Scaricamento di: $Label"
    Write-Host ""

    $barWidth  = 48

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $lastBytes = [long]0
        $lastTime  = [DateTime]::Now
        $resp = $null
        $stream = $null
        $out = $null

        try {
            if (Test-Path $Dest) { Remove-Item $Dest -Force }
            Enable-Tls12
            $req    = [System.Net.HttpWebRequest]::Create($Url)
            $req.UserAgent = "Mozilla/5.0"
            $req.Timeout = 300000
            $req.ReadWriteTimeout = 300000
            $resp   = $req.GetResponse()
            $total  = [long]$resp.ContentLength
            $stream = $resp.GetResponseStream()
            $out    = [System.IO.File]::Create($Dest)
            $buf    = New-Object byte[] 65536
            $done   = [long]0

            while ($true) {
                $read = $stream.Read($buf, 0, $buf.Length)
                if ($read -le 0) { break }
                $out.Write($buf, 0, $read)
                $done += $read

                $now     = [DateTime]::Now
                $elapsed = ($now - $lastTime).TotalSeconds
                if ($elapsed -ge 0.35) {
                    $speed     = ($done - $lastBytes) / $elapsed
                    $lastBytes = $done
                    $lastTime  = $now
                    $pct  = if ($total -gt 0) { [int](($done / $total) * 100) } else { 0 }
                    $fill = [int](($pct / 100) * $barWidth)
                    $bar  = ("#" * $fill) + ("-" * ($barWidth - $fill))

                    $eta = ""
                    if ($speed -gt 0 -and $total -gt 0) {
                        $rem = [int](($total - $done) / $speed)
                        $eta = "  tempo rimanente $([int]($rem/60))m$($rem%60)s"
                    }

                    $dl  = Format-Bytes $done
                    $tot = if ($total -gt 0) { " / " + (Format-Bytes $total) } else { "" }
                    $spd = Format-Speed $speed
                    Write-Host -NoNewline "`r  [$bar] $pct%  $dl$tot  $spd$eta   "
                }
            }

            if ($total -gt 0 -and $done -ne $total) {
                throw "Scaricamento interrotto: $(Format-Bytes $done) su $(Format-Bytes $total) ricevuti."
            }

            Write-Host "`r  [$("#" * $barWidth)] 100%  $(Format-Bytes $done)  Completato!                         " -ForegroundColor Green
            Write-Host ""
            return $true
        } catch {
            Write-Host ""
            if ($attempt -lt 3) {
                Print-Warn "Tentativo di scaricamento $attempt non riuscito: $_"
                Print-Info "Nuovo tentativo di scaricamento..."
                Start-Sleep -Seconds (2 * $attempt)
            } else {
                Print-Fail "Scaricamento non riuscito dopo $attempt tentativi: $_"
            }
        } finally {
            if ($out) { $out.Close() }
            if ($stream) { $stream.Close() }
            if ($resp) { $resp.Close() }
        }

        if (Test-Path $Dest) { Remove-Item $Dest -Force -ErrorAction SilentlyContinue }
    }

    return $false
}

function Expand-WithProgress {
    param([string]$ZipPath, [string]$Destination, [string]$Label)
    Print-Info "Estrazione di $Label..."
    Write-Host ""

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip   = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    $total = $zip.Entries.Count
    $barW  = 48
    $i = 0

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null

    foreach ($entry in $zip.Entries) {
        $i++
        $pct  = [int](($i / $total) * 100)
        $fill = [int](($pct / 100) * $barW)
        $bar  = ("#" * $fill) + ("-" * ($barW - $fill))
        $name = $entry.Name
        if ($name.Length -gt 28) { $name = "..." + $name.Substring($name.Length - 28) }
        Write-Host -NoNewline "`r  [$bar] $pct%  $name                    "

        if ($entry.FullName.EndsWith("/") -or $entry.FullName.EndsWith("\")) {
            New-Item -ItemType Directory -Force -Path (Join-Path $Destination $entry.FullName) | Out-Null
        } else {
            $destFile = Join-Path $Destination $entry.FullName
            $destDir  = Split-Path -Parent $destFile
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destFile, $true)
        }
    }

    $zip.Dispose()
    Write-Host "`r  [$("#" * $barW)] 100%  $total file estratti!                    " -ForegroundColor Green
    Write-Host ""
}

function Ensure-VisualCppRuntime {
    $requiredDlls = @(
        "VCRUNTIME140.dll",
        "VCRUNTIME140_1.dll",
        "MSVCP140.dll",
        "MSVCP140_CODECVT_IDS.dll",
        "VCOMP140.dll"
    )
    $systemDir = Join-Path $env:WINDIR "System32"
    $missingDlls = @($requiredDlls | Where-Object { -not (Test-Path (Join-Path $systemDir $_)) })

    if ($missingDlls.Count -eq 0) {
        Print-OK "Componente Microsoft Visual C++ gia' pronto."
        return
    }

    Print-Info "Preparazione di Microsoft Visual C++, necessario ai motori AI su Windows..."
    Print-Info "Windows potrebbe chiedere permessi di amministratore: rivolgiti al docente."
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $installer = Join-Path $toolsDir "vc_redist.x64.exe"
    $ok = Invoke-RichDownload `
        -Url "https://aka.ms/vc14/vc_redist.x64.exe" `
        -Dest $installer `
        -Label "Microsoft Visual C++ Redistributable (x64)"

    if (-not $ok) {
        throw "Impossibile scaricare Microsoft Visual C++. Chiedi al docente di installare https://aka.ms/vc14/vc_redist.x64.exe e riprova."
    }

    try {
        $process = Start-Process `
            -FilePath $installer `
            -ArgumentList "/install", "/passive", "/norestart" `
            -Verb RunAs `
            -Wait `
            -PassThru
        if ($process.ExitCode -notin @(0, 1638, 3010)) {
            throw "Il programma di installazione Microsoft Visual C++ ha restituito il codice $($process.ExitCode)."
        }
    } finally {
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }

    $missingDlls = @($requiredDlls | Where-Object { -not (Test-Path (Join-Path $systemDir $_)) })
    if ($missingDlls.Count -gt 0) {
        throw "Il componente Microsoft Visual C++ e' ancora incompleto. Mancano: $($missingDlls -join ', '). Chiedi al docente di riavviare Windows, installare https://aka.ms/vc14/vc_redist.x64.exe e riprovare."
    }

    Print-OK "Componente Microsoft Visual C++ installato."
}

# ══════════════════════════════════════════════════════════════════════════════
Print-Header
Print-Info "Serve Internet per scaricare i componenti mancanti. Non chiudere questa finestra."
Print-Info "I sei passaggi preparano gli strumenti; i modelli AI si scaricano poi dall'app."
Print-Info "Non stiamo addestrando un modello: stiamo preparando il programma che lo esegue."
Print-Info "I messaggi tecnici di npm e degli altri strumenti possono comparire in inglese."

$steps = 6

# ── Step 1: Portable Node.js ──────────────────────────────────────────────────
Print-Step 1 $steps "Preparazione di Node.js: esegue il programma locale"

$nodeReady = $false
if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) {
    try {
        $v = & $nodeExe --version
        # Test if npm is functional (doesn't throw parsing/unexpected token errors)
        $npmTest = & $nodeExe (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $npmTest -match "^\d+\.\d+\.\d+") {
            $nodeReady = $true
            Print-OK "Node.js portatile gia' pronto: $v"
        }
    } catch {}
}

if (-not $nodeReady) {
    if (Test-Path $nodeDir) {
        Print-Warn "Node.js portatile e' incompleto o danneggiato. Preparazione di una nuova copia..."
        Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    $nodeZip = Join-Path $toolsDir "node.zip"
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

    $ok = Invoke-RichDownload `
        -Url  "https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip" `
        -Dest $nodeZip `
        -Label "Node.js v22.12.0 LTS (Portable ZIP)"

    if (-not $ok) { Print-Fail "Impossibile scaricare Node.js. Controlla Internet e chiedi aiuto al docente."; Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1 }

    Expand-WithProgress -ZipPath $nodeZip -Destination $toolsDir -Label "Node.js"
    Remove-Item $nodeZip -Force

    $extracted = Get-ChildItem $toolsDir -Directory | Where-Object { $_.Name -like "node-v*" } | Select-Object -First 1
    if ($extracted) {
        if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
        Rename-Item $extracted.FullName "node-win"
    }

    # Pause briefly to allow USB drive writes to flush
    Print-Info "Attendi il completamento della scrittura dei file sul disco..."
    Start-Sleep -Seconds 3

    # Re-verify
    $nodeReady = $false
    if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) {
        try {
            $v = & $nodeExe --version
            $npmTest = & $nodeExe (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") --version 2>&1
            if ($LASTEXITCODE -eq 0 -and $npmTest -match "^\d+\.\d+\.\d+") {
                $nodeReady = $true
            }
        } catch {}
    }

    if (-not $nodeReady) {
        Print-Fail "Node.js e' incompleto o danneggiato. Chiedi al docente di chiudere Local Studio, rimuovere app/tools/node-win e riprovare."
        Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
    }

    Print-OK "Node.js portatile pronto: $v"
}

try {
    Ensure-VisualCppRuntime
} catch {
    Print-Fail $_
    Read-Host "Premi Invio per terminare e mostra il messaggio al docente"
    exit 1
}

Print-Step 2 $steps "Preparazione di llama.cpp: esegue la chat sulla CPU"
& (Join-Path $scriptDir "setup-llama.ps1")
if (-not $?) {
    Print-Fail "Preparazione di llama.cpp non riuscita."
    Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
}

Print-Step 3 $steps "Preparazione di Whisper: trasforma un audio in testo"
& (Join-Path $scriptDir "setup-whisper.ps1")
if (-not $?) {
    Print-Fail "Preparazione di Whisper non riuscita."
    Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
}

Print-Step 4 $steps "Preparazione di Kokoro: legge i testi con una voce sintetica"
& (Join-Path $scriptDir "setup-tts.ps1")
if (-not $?) {
    Print-Fail "Preparazione di Kokoro non riuscita."
    Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
}


Print-Step 5 $steps "Preparazione delle librerie per i pulsanti e le pagine dell'app"
Write-Host ""

if (-not (Test-Path $npmCmd)) {
    Print-Fail "Strumento npm.cmd non trovato in $npmCmd"
    Print-Fail "Chiedi al docente di chiudere Local Studio, rimuovere app/tools/node-win e riprovare."
    Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
}

# If node_modules is a Unix symlink/junction, remove it so Windows can install natively into a real directory
$nodeModulesDir = Join-Path $frontendDir "node_modules"
$activeOsFile = Join-Path $frontendDir ".active_modules_os"
$prevOs = ""
if (Test-Path $activeOsFile) {
    $prevOs = (Get-Content $activeOsFile -Raw).Trim()
}

if (Test-Path $nodeModulesDir) {
    $item = Get-Item $nodeModulesDir
    if ($item.Attributes -match "ReparsePoint") {
        Print-Info "Adattamento delle librerie a Windows: rimozione del collegamento Unix..."
        Remove-Item $nodeModulesDir -Force -ErrorAction SilentlyContinue
    } elseif ($prevOs -ne "windows" -and $prevOs -ne "") {
        # It's a real folder, but it belongs to another OS (e.g. linux or mac)
        Print-Info "Conservazione delle librerie per $prevOs in node_modules_$prevOs..."
        $targetDir = Join-Path $frontendDir "node_modules_$prevOs"
        if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force -ErrorAction SilentlyContinue }
        Move-Item $nodeModulesDir $targetDir -Force
    }
}

# Now swap in node_modules_windows if it exists
$winModulesDir = Join-Path $frontendDir "node_modules_windows"
if ((Test-Path $winModulesDir) -and -not (Test-Path $nodeModulesDir)) {
    Print-Info "Riutilizzo delle librerie gia' pronte per Windows..."
    Move-Item $winModulesDir $nodeModulesDir -Force
}

# Mark windows as active
"windows" | Out-File -FilePath $activeOsFile -NoNewline -Encoding utf8

Push-Location $frontendDir
$oldPath = $env:PATH
try {
    $env:PATH = "$nodeDir;$env:PATH"
    & $npmCmd install --prefer-offline --loglevel=error
    if ($LASTEXITCODE -ne 0) {
        Print-Fail "Installazione delle librerie non riuscita. Controlla Internet e mostra il messaggio al docente."
        Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
    }
    Write-Host ""
    Print-OK "Librerie dell'interfaccia installate."

    # ── Step 4: Build frontend ────────────────────────────────────────────────
    Print-Step 6 $steps "Creazione dell'interfaccia da aprire nel browser: app/dist/"
    Write-Host ""

    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) {
        Print-Fail "Creazione dell'interfaccia non riuscita. Mostra il messaggio al docente."
        Read-Host "Premi Invio per terminare e mostra il messaggio al docente"; exit 1
    }
    Write-Host ""
    Print-OK "Interfaccia pronta per il browser."
} finally {
    $env:PATH = $oldPath
    Pop-Location
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "   Preparazione completata. Premi Invio per proseguire con l'avvio." -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Read-Host "  Premi Invio per terminare la preparazione"
