param([switch]$NoOpen, [switch]$Stop)
$ErrorActionPreference = 'Stop'
trap {
    if (-not $NoOpen -and -not $Stop) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($_.Exception.Message, 'Gomoku computer engine') | Out-Null
    }
    Write-Host $_.Exception.Message
    exit 1
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceScript = Join-Path $PSScriptRoot 'server.js'
$nodePath = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
$dataRoot = Join-Path $env:LOCALAPPDATA 'GomokuRemote'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$sessionFile = Join-Path $dataRoot 'session.json'
$running = $null
if (Test-Path -LiteralPath $sessionFile) {
    $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($session.processId)" -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.CommandLine.Contains($serviceScript)) { $running = $candidate }
}
if ($Stop) {
    if ($running) {
        $stopKey = (Get-Content -LiteralPath (Join-Path $dataRoot 'pairing-key.txt') -Raw).Trim()
        $stopPort = if ($env:GOMOKU_REMOTE_PORT) { [int]$env:GOMOKU_REMOTE_PORT } else { 4188 }
        Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$stopPort/shutdown" -Headers @{'X-Gomoku-Token'=$stopKey} -TimeoutSec 5 | Out-Null
    }
    Write-Host 'Gomoku remote engine stopped.'
    exit
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'engine\manifest.json'))) {
    throw 'Run npm run remote:prepare -- --from YOUR_NATIVE_ENGINE_FOLDER first.'
}
if (-not $running) {
    $child = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serviceScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataRoot 'service.log') -RedirectStandardError (Join-Path $dataRoot 'service-error.log')
    @{processId=$child.Id; script=$serviceScript} | ConvertTo-Json | Set-Content -LiteralPath $sessionFile -Encoding UTF8
}
$port = if ($env:GOMOKU_REMOTE_PORT) { [int]$env:GOMOKU_REMOTE_PORT } else { 4188 }
$connected = $false
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $connected = $client.ConnectAsync('127.0.0.1', $port).Wait(100) } catch { $connected = $false } finally { $client.Dispose() }
    if ($connected) { break }
    Start-Sleep -Milliseconds 100
}
if (-not $connected) { throw "Engine service failed to start. See $dataRoot\service-error.log" }
$key = (Get-Content -LiteralPath (Join-Path $dataRoot 'pairing-key.txt') -Raw).Trim()
$pair = @{url="http://127.0.0.1:$port"; token=$key} | ConvertTo-Json -Compress
$gameUrl = 'https://5849mog.github.io/ai/?computer-launch=20261017#computer=' + [Uri]::EscapeDataString($pair)
if (-not $NoOpen) { Start-Process -FilePath $gameUrl }
Write-Host 'Gomoku remote engine is ready. The browser pairing button preserves your current game.'
