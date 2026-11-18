param([string]$Release = "v1.9.1")

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$appDir = Join-Path $rootDir "app"
$toolsDir = Join-Path $appDir "tools"
$speechWinRoot = Join-Path $appDir "speech-backend\win"
$speechRoot = Join-Path $speechWinRoot "cpu"

function Enable-Tls12 {
    try {
        $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    } catch {
        throw "Impossibile attivare la connessione sicura TLS 1.2: $($_.Exception.Message)"
    }
}

function Download-File {
    param([string]$Url, [string]$DestPath, [string]$Label)
    Write-Host "   >>  Scaricamento di $Label..."
    Enable-Tls12
    $client = New-Object System.Net.WebClient
    $client.Headers.Add("User-Agent", "Uncensored-AI-Studio")
    try {
        $client.DownloadFile($Url, $DestPath)
    } finally {
        $client.Dispose()
    }
}

function Find-FirstFile {
    param([string]$Root, [string[]]$Names)
    foreach ($name in $Names) {
        $found = Get-ChildItem $Root -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ieq $name } |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

New-Item -ItemType Directory -Force -Path $toolsDir, $speechRoot | Out-Null

$cliPath = Join-Path $speechRoot "whisper-cli.exe"
if (Test-Path $cliPath) {
    Write-Host "   OK  Motore di trascrizione Whisper gia' pronto."
    exit 0
}

$legacyCli = Join-Path $speechWinRoot "whisper-cli.exe"
$legacyServer = Join-Path $speechWinRoot "whisper-server.exe"
if (Test-Path $legacyCli) {
    Copy-Item $legacyCli $cliPath -Force
    if (Test-Path $legacyServer) {
        Copy-Item $legacyServer (Join-Path $speechRoot "whisper-server.exe") -Force
    }
    Get-ChildItem $speechWinRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin @("whisper-cli.exe", "whisper-server.exe") } |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $speechRoot $_.Name) -Force }
    Write-Host "   OK  Motore Whisper esistente trasferito in app/speech-backend/win/cpu."
    exit 0
}

$asset = "whisper-bin-x64.zip"
$archive = Join-Path $toolsDir $asset
$extract = Join-Path $toolsDir "whisper-extract"
$url = "https://github.com/ggml-org/whisper.cpp/releases/download/$Release/$asset"

Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue
Download-File -Url $url -DestPath $archive -Label "motore di trascrizione Whisper, versione $Release"

Write-Host "   >>  Estrazione del motore di trascrizione Whisper..."
Expand-Archive -Path $archive -DestinationPath $extract -Force

$cli = Find-FirstFile -Root $extract -Names @("whisper-cli.exe", "main.exe")
$server = Find-FirstFile -Root $extract -Names @("whisper-server.exe", "server.exe")
if (-not $cli) {
    throw "whisper-cli.exe non trovato dopo l'estrazione di $asset. Mostra questo errore al docente."
}

Get-ChildItem $extract -Recurse -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $speechRoot $_.Name) -Force
}
if ((Split-Path -Leaf $cli) -ine "whisper-cli.exe") {
    Copy-Item $cli $cliPath -Force
}
if ($server -and (Split-Path -Leaf $server) -ine "whisper-server.exe") {
    Copy-Item $server (Join-Path $speechRoot "whisper-server.exe") -Force
}

Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $cliPath)) {
    throw "Installazione di whisper-cli.exe non completata."
}
Write-Host "   OK  Motore di trascrizione Whisper installato."
Write-Host "   ..  Cartella del motore CPU: app/speech-backend/win/cpu"
