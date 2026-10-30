param([string]$PackageDirectory,[string]$Sample,[string]$OutputDirectory=$PSScriptRoot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
if (-not $PackageDirectory) {
    $picker=New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title='Select AVHub.exe from the extracted application package'
    $picker.Filter='AVHub application|AVHub.exe'
    if ($picker.ShowDialog() -ne 'OK') { exit 0 }
    $PackageDirectory=Split-Path -Parent $picker.FileName
}
if (-not $Sample) {
    $picker=New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title='Select Framecode-v2-640x360.mp4 or Precision-SDR10-3840x2160.mkv from the test kit'
    $picker.Filter='Test video|*.mp4;*.mkv'
    if ($picker.ShowDialog() -ne 'OK') { exit 0 }
    $Sample=$picker.FileName
}
$package=(Resolve-Path -LiteralPath $PackageDirectory).Path
$samplePath=(Resolve-Path -LiteralPath $Sample).Path
$runtime=Join-Path $package 'resources\native-render'
$report=[ordered]@{schema=1;scope='Direct diagnostic helper startup only; not Electron compositor or full playback acceptance';passed=$false}
$process=$null;$started=$false
try {
    if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell' }
    $report.os=[Environment]::OSVersion.VersionString
    $report.frameworkRelease=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue).Release
    $report.gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion)
    $report.layout=[ordered]@{applicationExists=(Test-Path -LiteralPath (Join-Path $package 'AVHub.exe') -PathType Leaf);nativeDirectoryExists=(Test-Path -LiteralPath $runtime -PathType Container)}
    if (-not $report.layout.applicationExists) { throw 'The selected location does not contain AVHub.exe. Select the actual EXE from the completely extracted application, not its parent folder or the diagnostic kit.' }
    if (-not $report.layout.nativeDirectoryExists) { throw 'The selected application has no resources/native-render directory. Verify full extraction of the dedicated render acceptance package.' }
    $pin=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-pin.json') -Raw | ConvertFrom-Json
    $files=@([pscustomobject]@{name='libmpv-2.dll';sha256=$pin.dllSha256})+@($pin.dependencies)
    $report.files=@($files | ForEach-Object {
        $file=Join-Path $runtime $_.name
        $digest=if(Test-Path -LiteralPath $file -PathType Leaf){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
        [ordered]@{name=$_.name;present=($null -ne $digest);matches=($digest -eq $_.sha256);sha256=$digest}
    })
    if (@($report.files | Where-Object {-not $_.present}).Count) { throw 'One or more package DLL files are missing; verify complete extraction or quarantine records. See files in this report.' }
    if (@($report.files | Where-Object {-not $_.matches}).Count) { throw 'Present package DLL files differ from the pinned closure; see files in this report' }
    $hash=(Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $known=@{
        '4da5a210f5086e11658c04657ebaa653a5934efeb6b6929ca2747684ecbfa2d0'=@{width=640;height=360;depth=8}
        'e45b97729cb7b5c3ad71d0036a0771d0016f0452e95a71cfa6bd97c9e91e3e0c'=@{width=3840;height=2160;depth=10}
    }
    if (-not $known.ContainsKey($hash)) { throw 'Only the two exact generated test-kit samples are accepted; no colour metadata is guessed' }
    $report.sampleSha256=$hash
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AVHubRuntimeProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module);
}
'@
    $dll=Join-Path $runtime 'libmpv-2.dll'
    $module=[AVHubRuntimeProbe]::LoadLibraryEx($dll,[IntPtr]::Zero,0x1100)
    $loadError=if($module -eq [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
    $report.dllLoad=[ordered]@{loaded=($module -ne [IntPtr]::Zero);win32Error=$loadError}
    if ($module -ne [IntPtr]::Zero) { [void][AVHubRuntimeProbe]::FreeLibrary($module) }
    if ($loadError) { throw ('Native DLL loading failed, Win32 error '+$loadError) }
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName=Join-Path $PSScriptRoot 'DiagnosticRenderHost.exe'
    $info.Arguments='"'+$dll+'"'
    $info.WorkingDirectory=$runtime
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object System.Diagnostics.Process;$process.StartInfo=$info
    if (-not $process.Start()) { throw 'Diagnostic helper did not start' }
    $started=$true
    $stderr=$process.StandardError.ReadToEndAsync()
    function Send-Request($request) {
        $process.StandardInput.WriteLine(($request | ConvertTo-Json -Compress));$process.StandardInput.Flush()
        $line=$process.StandardOutput.ReadLineAsync()
        if (-not $line.Wait(15000)) { throw 'Diagnostic helper response timed out' }
        if (-not $line.Result) { throw 'Diagnostic helper exited before replying' }
        $reply=$line.Result | ConvertFrom-Json
        if ($reply.error) { throw ('Diagnostic helper reply: '+$reply.error) }
        return $reply.result
    }
    $contract=$known[$hash]
    $report.open=Send-Request @{id=1;action='open';path=$samplePath;width=$contract.width;height=$contract.height;depth=$contract.depth;primaries='bt709';transfer='bt709';matrix='bt709';range='tv';hdr=$false;startSec=0;autoplay=$false;windowHandle='0'}
    $report.display=Send-Request @{id=2;action='display'}
    $report.resources=Send-Request @{id=3;action='resources'}
    $null=Send-Request @{id=4;action='quiesce'}
    $frame=Send-Request @{id=5;action='frame'}
    if ($frame.waiting) { $null=Send-Request @{id=6;action='ack';value=$frame.serial} }
    $null=Send-Request @{id=7;action='quit'}
    if (-not $process.WaitForExit(5000)) { throw 'Diagnostic helper shutdown timed out' }
    $report.passed=($process.ExitCode -eq 0)
} catch {
    $report.error=$_.Exception.Message
} finally {
    if ($process -and $started) {
        if (-not $process.HasExited) { $process.Kill();$process.WaitForExit();$report.forcedTermination=$true }
        $report.exitCode=$process.ExitCode
        $report.statusHex=('0x{0:X8}' -f $process.ExitCode)
        if ($stderr -and $stderr.Wait(5000)) {
            $text=$stderr.Result.Replace($samplePath,'<test-sample>').Replace($package,'<package>')
            $report.stderr=$text.Substring(0,[Math]::Min($text.Length,65536))
        }
        $process.Dispose()
    }
    $destination=Join-Path $OutputDirectory ('render-startup-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.json')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $destination -Encoding UTF8
    Write-Host ('Diagnostic report: '+$destination)
}
