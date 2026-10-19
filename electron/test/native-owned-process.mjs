import {execFileSync} from 'node:child_process';
export function nativeProcessMetrics(parentPid){
  if(!Number.isSafeInteger(parentPid)||parentPid<=0)throw new Error('Invalid owned parent PID');
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid} AND Name = 'mpv.exe'" | Select-Object ProcessId,WorkingSetSize,HandleCount,ReadTransferCount,WriteTransferCount,UserModeTime,KernelModeTime) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
  const value=output?JSON.parse(output):[];return Array.isArray(value)?value:[value];
}
