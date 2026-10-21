param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$url = 'http://127.0.0.1:4173/'
$mutex = [System.Threading.Mutex]::new($false, 'Local\FrameStudioDesktopLauncher')
$locked = $false
function Test-Listening([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
function Test-Service([string]$Address, [string]$Expected) {
    try {
        $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains($Expected)
    } catch { return $false }
}
try {
    $locked = $mutex.WaitOne(60000)
    if (-not $locked) { throw 'Another Frame Studio launch is taking too long.' }
    $node = (Get-Command node -ErrorAction Stop).Source
    $logs = Join-Path $project '.logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    if (-not (Test-Listening 4174)) {
        Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env', 'server/index.mjs' -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log')
    }
    if (-not (Test-Listening 4173)) {
        Start-Process -FilePath $node -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort' -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log')
    }
    $ready = $false
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $ready = (Test-Service $url 'Frame Studio') -and (Test-Service 'http://127.0.0.1:4174/api/status' 'videoConfigured')
        if (-not $ready) { Start-Sleep -Milliseconds 500 }
    } until ($ready -or (Get-Date) -gt $deadline)
    if (-not $ready) { throw "Frame Studio could not start. Check logs in $logs" }
    if (-not $NoBrowser) { Start-Process $url }
    Write-Output 'Frame Studio is ready at http://127.0.0.1:4173/'
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Frame Studio') | Out-Null
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
