param([switch]$SkipDependencyInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

if ($env:OS -ne 'Windows_NT') { throw 'This portable application must be built on Windows.' }
if (-not (Test-Path 'bin\ffmpeg.exe') -or -not (Test-Path 'bin\ffprobe.exe')) {
    throw 'Missing bin\ffmpeg.exe or bin\ffprobe.exe. Provide Windows binaries first.'
}
& (Join-Path $projectRoot 'bin\ffmpeg.exe') -version *> $null
if ($LASTEXITCODE -ne 0) { throw 'bin\ffmpeg.exe cannot run or is not a valid Windows executable.' }
& (Join-Path $projectRoot 'bin\ffprobe.exe') -version *> $null
if ($LASTEXITCODE -ne 0) { throw 'bin\ffprobe.exe cannot run or is not a valid Windows executable.' }
if (-not (Test-Path 'package-lock.json')) { throw 'package-lock.json is required for reproducible installation.' }
python scripts/prepare-sqlite.py
if ($LASTEXITCODE -ne 0) { throw 'Pinned SQLite preparation failed.' }
python scripts/python-runtime.py --check
if ($LASTEXITCODE -ne 0) { throw 'Pinned SQLite runtime verification failed.' }
$sqliteManifest = Get-Content -LiteralPath 'app/sqlite-runtime.json' -Raw | ConvertFrom-Json
$sqliteBinary = Join-Path $projectRoot ('bin\sqlite\' + $sqliteManifest.version + '\sqlite3.dll')

if (-not $SkipDependencyInstall) {
    python -m pip install --disable-pip-version-check -r requirements.txt -r requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend and Electron dependency installation failed.' }
}
node node_modules/electron/install.js
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime installation failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
npm run build:electron
if ($LASTEXITCODE -ne 0) { throw 'Electron compilation failed.' }

$backendDist = Join-Path $projectRoot 'build\backend-dist'
$backendWork = Join-Path $projectRoot 'build\pyinstaller'
$backendSpec = Join-Path $projectRoot 'build\spec'
python scripts/python-runtime.py -m PyInstaller --noconfirm --clean --onedir --console --name AVHubServer `
  --distpath $backendDist --workpath $backendWork --specpath $backendSpec `
  --add-data "$projectRoot\app\static;app\static" `
  --add-data "$projectRoot\app\build-info.json;app" `
  --add-data "$projectRoot\app\sqlite-runtime.json;app" `
  --add-data "$projectRoot\bin\SQLite-LICENSE.txt;licenses" `
  --add-data "$projectRoot\bin\SQLite-BUILD-INFO.txt;licenses" `
  --add-binary "$sqliteBinary;." `
  --runtime-hook "$projectRoot\scripts\pyi-sqlite-runtime.py" `
  --add-data "$projectRoot\bin\FFmpeg-LICENSE.txt;licenses" `
  --add-data "$projectRoot\bin\FFmpeg-BUILD-INFO.txt;licenses" `
  --add-binary "$projectRoot\bin\ffmpeg.exe;bin" `
  --add-binary "$projectRoot\bin\ffprobe.exe;bin" `
  --collect-all fastapi --collect-all starlette --collect-all uvicorn --collect-all pydantic `
  run.py
if ($LASTEXITCODE -ne 0) { throw 'FastAPI backend packaging failed.' }
python scripts/verify-bundled-sqlite.py
if ($LASTEXITCODE -ne 0) { throw 'Bundled SQLite verification failed; refusing to package desktop assets.' }

npm run package:windows
if ($LASTEXITCODE -ne 0) { throw 'Electron Windows portable packaging failed.' }
python scripts/folder-portable.py
if ($LASTEXITCODE -ne 0) { throw 'Folder portable ZIP creation failed.' }

$artifact = Get-ChildItem 'dist\electron\AVHub-portable-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $artifact) { throw 'Portable EXE was not found after the build.' }
Write-Host "AVHub portable build: $($artifact.FullName)"
Write-Host 'Data defaults to AVHub-data beside the EXE; custom locations are supported in Settings.'
