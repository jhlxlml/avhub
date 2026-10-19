param(
    [Parameter(Mandatory = $true)][string]$IndexPath,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$MediaId,
    [ValidateRange(60, 7200)][int]$Seconds = 3600
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$indexResolved = (Resolve-Path -LiteralPath $IndexPath).ProviderPath
if (-not (Test-Path -LiteralPath $indexResolved -PathType Leaf)) { throw 'IndexPath must be an existing authorized SQLite index.' }
foreach ($relative in @('electron/dist/main.js', 'app/static/index.html', 'app/build-info.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw 'Build the desktop app before starting the test. Do not rebuild during a running test.' }
}
$runName = 'library-soak-run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path (Join-Path $projectRoot 'build') $runName
New-Item -ItemType Directory -Path $runDirectory | Out-Null
$stopPath = Join-Path $runDirectory 'stop'
$stdout = Join-Path $runDirectory 'stdout.log'
$stderr = Join-Path $runDirectory 'stderr.log'
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$harness = Join-Path $PSScriptRoot 'desktop-cover-stress.mjs'
$arguments = @("`"$harness`"", "`"$indexResolved`"", "--seconds=$Seconds", '--hardware-gpu', '--walk', "--playback-id=$MediaId", '--playback-every=10', "--stop-file=`"$stopPath`"")
# This is a bounded test, not an installed service or scheduled automation.
# Hide the helper console; the isolated Electron test window remains visible.
$testProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$buildInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'app/build-info.json') -Raw | ConvertFrom-Json
$manifest = [ordered]@{ processId = $testProcess.Id; startedAt = [DateTimeOffset]::Now.ToString('o'); requestedSeconds = $Seconds; mediaId = $MediaId; buildId = $buildInfo.build_id; stopFile = $stopPath; stdout = $stdout; stderr = $stderr }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'run.json') -Encoding UTF8
$manifest | ConvertTo-Json
