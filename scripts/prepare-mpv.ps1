param([switch]$Offline, [switch]$Candidate, [switch]$Sources)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$arguments = @((Join-Path $project 'scripts/prepare-mpv.py'))
if ($Offline) { $arguments += '--offline' }
if ($Candidate) { $arguments += '--candidate' }
if ($Sources) { $arguments += '--sources' }
python @arguments
if ($LASTEXITCODE -ne 0) { throw 'MPV preparation failed; existing runtime was preserved. See the error above.' }
