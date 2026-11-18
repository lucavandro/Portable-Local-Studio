param([string]$Release = "b11418")

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$appDir = Join-Path $rootDir "app"
$toolsDir = Join-Path $appDir "tools"
$llmRoot = Join-Path $appDir "llm-backend\win"

function Enable-Tls12 {
    try {
        $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    } catch {
        throw "Impossibile attivare la connessione sicura TLS 1.2: $($_.Exception.Message)"
    }
}

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

function Download-File {
    param([string]$Url, [string]$DestPath, [string]$Label)
    
    $barWidth  = 48

    Write-Host "   >>  Scaricamento di $Label..."

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $lastBytes = [long]0
        $lastTime  = [DateTime]::Now
        $resp = $null
        $stream = $null
        $out = $null

        try {
            if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
            Enable-Tls12
            $req    = [System.Net.HttpWebRequest]::Create($Url)
            $req.UserAgent = "Mozilla/5.0"
            $req.Timeout = 300000
            $req.ReadWriteTimeout = 300000
            $resp   = $req.GetResponse()
            $total  = [long]$resp.ContentLength
            $stream = $resp.GetResponseStream()
            $out    = [System.IO.File]::Create($DestPath)
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
                    Write-Host -NoNewline "`r      [$bar] $pct%  $dl$tot  $spd$eta   "
                }
            }

            if ($total -gt 0 -and $done -ne $total) {
                throw "Scaricamento interrotto: $(Format-Bytes $done) su $(Format-Bytes $total) ricevuti."
            }

            Write-Host "`r      [$("#" * $barWidth)] 100%  $(Format-Bytes $done)  Completato!                         " -ForegroundColor Green
            Write-Host ""
            return
        } catch {
            Write-Host ""
            if ($attempt -lt 3) {
                Write-Host "   !!  Tentativo di scaricamento $attempt non riuscito: $_" -ForegroundColor Yellow
                Write-Host "   >>  Nuovo tentativo di scaricamento..." -ForegroundColor Cyan
                Start-Sleep -Seconds (2 * $attempt)
            } else {
                throw "Scaricamento non riuscito dopo $attempt tentativi: $_"
            }
        } finally {
            if ($out) { $out.Close() }
            if ($stream) { $stream.Close() }
            if ($resp) { $resp.Close() }
        }

        if (Test-Path $DestPath) { Remove-Item $DestPath -Force -ErrorAction SilentlyContinue }
    }
}

function Install-LlamaArchive {
    param([string]$Variant, [string]$AssetName)

    $dest = Join-Path $llmRoot $Variant
    $server = Join-Path $dest "llama-server.exe"
    $stamp = Join-Path $dest ".llama-release"
    if (Test-Path $server) {
        $installedRelease = ""
        if (Test-Path $stamp) { $installedRelease = (Get-Content $stamp -Raw).Trim() }
        if ($installedRelease -eq $Release) {
            Write-Host "   OK  Motore chat llama.cpp $Variant gia' pronto, versione $Release."
            return
        }
        Write-Host "   >>  Aggiornamento del motore chat llama.cpp $Variant a $Release, versione installata: $(if ($installedRelease) { $installedRelease } else { 'sconosciuta' })."
    }

    $archive = Join-Path $toolsDir $AssetName
    $extract = Join-Path $toolsDir "llama-$Variant-extract"
    $url = "https://github.com/ggml-org/llama.cpp/releases/download/$Release/$AssetName"

    New-Item -ItemType Directory -Force -Path $toolsDir, $dest | Out-Null
    Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue

    Download-File -Url $url -DestPath $archive -Label "motore chat llama.cpp $Variant, versione $Release"

    Write-Host "   >>  Estrazione del motore chat llama.cpp $Variant..."
    Expand-Archive -Path $archive -DestinationPath $extract -Force

    # Clear the previous release first so stale DLLs from an older layout (monolithic vs
    # modular *-impl.dll / mtmd.dll builds) are not mixed with the new files.
    Get-ChildItem $dest -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    Get-ChildItem $extract -Recurse -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force
    }
    Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $server)) {
        throw "llama-server.exe non trovato dopo l'estrazione di $AssetName. Mostra questo errore al docente."
    }
    Set-Content -Path $stamp -Value $Release -Encoding ASCII
    Write-Host "   OK  Motore chat llama.cpp $Variant installato."
}

Install-LlamaArchive -Variant "cpu" -AssetName "llama-$Release-bin-win-cpu-x64.zip"
