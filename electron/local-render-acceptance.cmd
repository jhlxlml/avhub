@echo off
setlocal
set "AVHUB_RENDER_LOCAL_ACCEPTANCE=1"
set "AVHUB_RENDER_RUNTIME_CANDIDATE="
set "AVHUB_DATA_DIR=%~dp0AVHub-data-acceptance"
start "" "%~dp0AVHub.exe"
