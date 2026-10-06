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

python -m pip install --disable-pip-version-check -r requirements.txt -r requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Frontend and Electron dependency installation failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
npm run build:electron
if ($LASTEXITCODE -ne 0) { throw 'Electron compilation failed.' }

$backendDist = Join-Path $projectRoot 'build\backend-dist'
$backendWork = Join-Path $projectRoot 'build\pyinstaller'
$backendSpec = Join-Path $projectRoot 'build\spec'
python -m PyInstaller --noconfirm --clean --onedir --console --name AVHubServer `
  --distpath $backendDist --workpath $backendWork --specpath $backendSpec `
  --add-data "$projectRoot\app\static;app\static" `
  --add-data "$projectRoot\app\build-info.json;app" `
  --add-data "$projectRoot\bin\FFmpeg-LICENSE.txt;licenses" `
  --add-data "$projectRoot\bin\FFmpeg-BUILD-INFO.txt;licenses" `
  --add-binary "$projectRoot\bin\ffmpeg.exe;bin" `
  --add-binary "$projectRoot\bin\ffprobe.exe;bin" `
  --collect-all fastapi --collect-all starlette --collect-all uvicorn --collect-all pydantic `
  run.py
if ($LASTEXITCODE -ne 0) { throw 'FastAPI backend packaging failed.' }

npm run package:windows
if ($LASTEXITCODE -ne 0) { throw 'Electron Windows portable packaging failed.' }

$artifact = Get-ChildItem 'dist\electron\AVHub-portable-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $artifact) { throw 'Portable EXE was not found after the build.' }
Write-Host "AVHub portable build: $($artifact.FullName)"
Write-Host 'Data defaults to AVHub-data beside the EXE; custom locations are supported in Settings.'
