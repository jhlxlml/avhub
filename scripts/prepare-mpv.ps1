$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $project 'electron/mpv-runtime.json') -Raw | ConvertFrom-Json
$asset = $manifest.asset
$expected = $manifest.archiveSha256
if ($manifest.schema -ne 1 -or $expected -notmatch '^[a-f0-9]{64}$' -or $manifest.url -ne "https://github.com/mpv-player/mpv/releases/download/git-release/$asset" -or $asset -notmatch '^mpv-[a-zA-Z0-9._-]+\.zip$') { throw 'Invalid MPV runtime manifest' }
$folder = Join-Path $project 'build/mpv-download'
$target = Join-Path $project 'bin/mpv'
New-Item -ItemType Directory -Force $folder | Out-Null
$zip = Join-Path $folder 'runtime.zip'
if (!(Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest $manifest.url -OutFile $zip
}
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'MPV archive SHA-256 mismatch' }
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $folder 'unpacked') -Force
if ((Get-FileHash -LiteralPath (Join-Path $folder 'unpacked/mpv.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.exeSha256) { throw 'MPV executable SHA-256 mismatch' }
if ((Get-FileHash -LiteralPath (Join-Path $folder 'unpacked/LICENSE.GPL') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.licenseSha256) { throw 'MPV license SHA-256 mismatch' }
New-Item -ItemType Directory -Force $target | Out-Null
# No updater, installer, user config or third-party scripts enter the runtime.
Copy-Item -LiteralPath (Join-Path $folder 'unpacked/mpv.exe') -Destination $target
Copy-Item -LiteralPath (Join-Path $folder 'unpacked/LICENSE.GPL') -Destination $target
Write-Output 'Pinned MPV runtime prepared. No media or application data was changed.'
