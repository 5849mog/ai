param([switch]$NoOpen, [switch]$Stop)
$ErrorActionPreference = 'Stop'
trap {
    if (-not $NoOpen -and -not $Stop) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($_.Exception.Message, 'Gomoku phone connection') | Out-Null
    }
    Write-Host $_.Exception.Message
    exit 1
}
$data = Join-Path $env:LOCALAPPDATA 'GomokuRemote'
$sessionFile = Join-Path $data 'phone-session.json'
$script = Join-Path $PSScriptRoot 'phone.js'
$running = $null
if (Test-Path -LiteralPath $sessionFile) {
    $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($session.processId)" -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.CommandLine.Contains($script)) { $running = $candidate }
}
if ($Stop) {
    if ($running) {
        $address = [Uri]$session.controlUrl
        Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($address.GetLeftPart([UriPartial]::Authority) + '/api/exit') -Headers @{Authorization=('Bearer ' + $address.Fragment.TrimStart('#'))} -TimeoutSec 5 | Out-Null
    }
    Write-Host 'Gomoku phone connection stopped.'
    exit
}
& (Join-Path $PSScriptRoot 'start.ps1') -NoOpen
if (-not $?) { throw 'Computer engine could not start.' }
if (-not $running) {
    $nodePath = 'C:\Program Files\nodejs\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
    Start-Process -FilePath $nodePath -ArgumentList @('"' + $script + '"') -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'phone.log') -RedirectStandardError (Join-Path $data 'phone-error.log') | Out-Null
}
$ready = $false
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if (Test-Path -LiteralPath $sessionFile) {
        $session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
        $address = [Uri]$session.controlUrl
        try {
            Invoke-WebRequest -UseBasicParsing -Uri ($address.GetLeftPart([UriPartial]::Authority) + '/api/status') -Headers @{Authorization=('Bearer ' + $address.Fragment.TrimStart('#'))} -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    Start-Sleep -Milliseconds 100
}
if (-not $ready) { throw "Phone connection window failed to start. See $data\phone-error.log" }
if (-not $NoOpen) { Start-Process -FilePath $session.controlUrl }
Write-Host 'Gomoku phone connection window is ready.'
