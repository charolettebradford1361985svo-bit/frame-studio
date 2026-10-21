$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'launch-desktop.ps1') -NoBrowser
$before = @(Get-NetTCPConnection -LocalPort 4173,4174 -State Listen | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique)
& (Join-Path $PSScriptRoot 'launch-desktop.ps1') -NoBrowser
$after = @(Get-NetTCPConnection -LocalPort 4173,4174 -State Listen | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique)
if ($before.Count -ne 2 -or (Compare-Object $before $after)) { throw 'Repeated launch must reuse both servers.' }
$html = Invoke-WebRequest 'http://127.0.0.1:4173/' -UseBasicParsing -TimeoutSec 10
if (-not $html.Content.Contains('/frame-studio-logo.png')) { throw 'Logo is missing from HTML.' }
$image = Invoke-WebRequest 'http://127.0.0.1:4173/frame-studio-logo.png' -UseBasicParsing -TimeoutSec 10
if ($image.StatusCode -ne 200 -or $image.Headers['Content-Type'] -notlike 'image/png*') { throw 'Logo cannot be loaded.' }
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Frame Studio.lnk'
if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'Desktop shortcut is missing.' }
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
if (-not $link.Arguments.Contains((Join-Path $project 'scripts\launch-desktop.ps1'))) { throw 'Shortcut points to the wrong launcher.' }
if ($link.IconLocation -ne "$(Join-Path $project 'public\frame-studio.ico'),0") { throw 'Shortcut points to the wrong icon.' }
Write-Output 'PASS: startup, repeated launch, logo response, shortcut target and icon.'
