param(
    [ValidateRange(60, 7200)][int]$Seconds = 1200,
    [ValidateRange(192, 2000)][int]$Videos = 600
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
foreach ($relative in @('electron/dist/main.js', 'app/static/index.html', 'app/build-info.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw 'Build the desktop app first; do not rebuild during this test.' }
}
$runName = 'desktop-usage-run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path (Join-Path $projectRoot 'build') $runName
New-Item -ItemType Directory -Path $runDirectory | Out-Null
$stdout = Join-Path $runDirectory 'stdout.log'
$stderr = Join-Path $runDirectory 'stderr.log'
$stopFile = Join-Path $runDirectory 'stop'
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$harness = Join-Path $PSScriptRoot 'desktop-usage-soak.mjs'
$arguments = @("`"$harness`"", "--seconds=$Seconds", "--videos=$Videos", "--stop-file=`"$stopFile`"")
# Bounded isolated test only: no service, scheduler or developer console window.
$testProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$buildInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'app/build-info.json') -Raw | ConvertFrom-Json
$manifest = [ordered]@{processId=$testProcess.Id;startedAt=[DateTimeOffset]::Now.ToString('o');seconds=$Seconds;videos=$Videos;buildId=$buildInfo.build_id;stopFile=$stopFile;stdout=$stdout;stderr=$stderr}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'run.json') -Encoding UTF8
$manifest | ConvertTo-Json
