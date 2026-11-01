// Actual desktop observations, not a decoder simulator or release certificate.
import {spawnSync} from 'node:child_process';

export function seekPercentiles(seeks){
 const values=seeks.map(seek=>seek.ms).sort((a,b)=>a-b),n=values.length;
 if(!n)throw new Error('Cannot summarize unmeasured seeks');
 return {count:n,p50:n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2,p95:values[Math.ceil(n*.95)-1],max:values.at(-1)};
}

export async function benchmarkResources(desktop){
 const electron=await desktop.evaluate(({app})=>({at:Date.now(),pid:process.pid,versions:process.versions,features:app.getGPUFeatureStatus(),processes:app.getAppMetrics().map(m=>({type:m.type,pid:m.pid,cpuPercent:m.cpu.percentCPUUsage,workingSetKiB:m.memory.workingSetSize,privateKiB:m.memory.privateBytes??null}))}));
 if(process.platform!=='win32')return {electron,system:{status:'SKIP',reason:'Windows process/GPU counters required'}};
 const command=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$benchPids=New-Object 'System.Collections.Generic.HashSet[int]'
[void]$benchPids.Add(${electron.pid})
$benchInventory=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,HandleCount,ReadTransferCount,WriteTransferCount,UserModeTime,KernelModeTime)
do {$benchAdded=$false;foreach($entry in $benchInventory){if($benchPids.Contains([int]$entry.ParentProcessId)-and !$benchPids.Contains([int]$entry.ProcessId)){[void]$benchPids.Add([int]$entry.ProcessId);$benchAdded=$true}}}while($benchAdded)
$benchOwned=@($benchInventory | Where-Object {$benchPids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,HandleCount,ReadTransferCount,WriteTransferCount,UserModeTime,KernelModeTime)
$benchGpu=@();$benchGpuStatus='PASS';$benchGpuReason=$null
try {$benchGpu=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object {$_.Name -match 'pid_(\\d+)_' -and $benchPids.Contains([int]$Matches[1])} | Select-Object Name,UtilizationPercentage);if(!$benchGpu.Count){$benchGpuStatus='SKIP';$benchGpuReason='No owned GPU counter instances observed'}}catch{$benchGpuStatus='BLOCKED';$benchGpuReason=$_.Exception.Message}
[pscustomobject]@{status='PASS';processes=$benchOwned;ffmpegProcesses=@($benchOwned|Where-Object Name -eq 'ffmpeg.exe').Count;gpuStatus=$benchGpuStatus;gpuReason=$benchGpuReason;gpu=$benchGpu} | ConvertTo-Json -Compress -Depth 7`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2*1024**2});
 return {electron,system:result.status===0?JSON.parse(result.stdout.trim()):{status:'BLOCKED',exitCode:result.status,error:String(result.error??result.stderr)},scope:'Sampled owned process tree and GPU counters include compositor barcode verification; sampled counts, not peak or isolated decoder cost'};
}
