# Called by windows.bat on every launch. Re-runs setup-llama.ps1 when an installed llama.cpp
# backend is older than the release pinned in setup-llama.ps1, so existing installs pick up
# backend fixes without a full repair. Never blocks launch: failures only warn.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$llmRoot = Join-Path $rootDir "app\llm-backend\win"

try {
    $setupScript = Join-Path $scriptDir "setup-llama.ps1"
    $match = Select-String -Path $setupScript -Pattern 'param\(\[string\]\$Release = "([^"]+)"\)' | Select-Object -First 1
    if (-not $match -or -not (Test-Path $llmRoot)) { exit 0 }
    $required = $match.Matches[0].Groups[1].Value

    $stale = $null
    foreach ($server in Get-ChildItem -Path (Join-Path $llmRoot "cpu") -Filter "llama-server.exe" -File -ErrorAction SilentlyContinue) {
        $stamp = Join-Path $server.DirectoryName ".llama-release"
        $installed = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
        if ($installed -ne $required) {
            $stale = "$($server.Directory.Name) ($(if ($installed) { $installed } else { 'sconosciuta' }))"
            break
        }
    }
    if (-not $stale) { exit 0 }

    Write-Host ""
    Write-Host "  Aggiornamento del motore chat llama.cpp a $required. Versione presente: $stale."
    & $setupScript
    Write-Host "  Motore chat llama.cpp aggiornato."
} catch {
    Write-Host "  [AVVISO] Aggiornamento di llama.cpp non riuscito. Controlla Internet. Uso la versione gia' installata." -ForegroundColor Yellow
    Write-Host "         $($_.Exception.Message)" -ForegroundColor DarkYellow
}
exit 0
