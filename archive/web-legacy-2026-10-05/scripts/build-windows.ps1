$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

if ($env:OS -ne 'Windows_NT') { throw '该便携包只能在 Windows 上构建。' }
if (-not (Test-Path 'bin\ffmpeg.exe') -or -not (Test-Path 'bin\ffprobe.exe')) {
    throw '缺少 bin\ffmpeg.exe 或 bin\ffprobe.exe。请先准备这两个 Windows 可执行文件，再重新构建。'
}
& (Join-Path $projectRoot 'bin\ffmpeg.exe') -version *> $null
if ($LASTEXITCODE -ne 0) { throw 'bin\ffmpeg.exe 无法运行或不是有效的 Windows 可执行文件。' }
& (Join-Path $projectRoot 'bin\ffprobe.exe') -version *> $null
if ($LASTEXITCODE -ne 0) { throw 'bin\ffprobe.exe 无法运行或不是有效的 Windows 可执行文件。' }
if (-not (Test-Path 'package-lock.json')) { throw '缺少 package-lock.json，无法执行可复现的前端安装。' }

python -m pip install --disable-pip-version-check -r requirements.txt -r requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw '安装 Python 构建依赖失败。' }
npm ci
if ($LASTEXITCODE -ne 0) { throw '安装前端及 Electron 构建依赖失败。' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '网页前端构建失败。' }
npm run build:electron
if ($LASTEXITCODE -ne 0) { throw 'Electron 主进程编译失败。' }

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
if ($LASTEXITCODE -ne 0) { throw 'FastAPI 媒体服务打包失败。' }

npm run package:windows
if ($LASTEXITCODE -ne 0) { throw 'Electron Windows 便携包构建失败。' }

$artifact = Get-ChildItem 'dist\electron\AVHub-portable-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $artifact) { throw '构建完成但未找到便携版 EXE。' }
Write-Host "AVHub Electron 便携版已生成：$($artifact.FullName)"
Write-Host '数据保存在 EXE 同目录的 AVHub-data；目录不可写时回退到当前 Windows 用户的数据目录。'
