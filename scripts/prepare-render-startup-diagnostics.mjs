// Separate troubleshooting host: identical playback logic from the frozen
// tested candidate; only exception output is expanded. Never replace the app
// helper or relabel these results as Electron compositor acceptance.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),folder=mkdtempSync(path.join(root,'build/render-startup-diagnostics-')),source=path.join(folder,'source');mkdirSync(source);
const candidate=path.join(root,'build/render-replayed-candidate-Aa7Otl/source/electron/native/render');
for(const name of ['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs']){
 let text=readFileSync(path.join(candidate,name),'utf8');
 if(name==='RenderHost.cs'){
  const loop='renderError=ex.GetType().Name;ready.Set();',main='Console.Error.WriteLine(ex.GetType().Name+": native host could not start");';
  if(!text.includes(loop)||!text.includes(main))throw new Error('Frozen diagnostic source anchors changed');
  text=text.replace(loop,'renderError=ex.GetType().Name;Console.Error.WriteLine("DIAGNOSTIC render-loop: "+ex.ToString());ready.Set();').replace(main,'Console.Error.WriteLine("DIAGNOSTIC startup: "+ex.ToString());');
 }
 writeFileSync(path.join(source,name),text);
}
execFileSync(path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/platform:x64','/target:exe',`/out:${path.join(folder,'DiagnosticRenderHost.exe')}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'].map(n=>path.join(source,n))],{windowsHide:true,stdio:'inherit'});
copyFileSync(path.join(root,'scripts/diagnose-render-startup.ps1'),path.join(folder,'diagnose-render-startup.ps1'));
copyFileSync(path.join(root,'ci/replayed-render-runtime.json'),path.join(folder,'runtime-pin.json'));
copyFileSync(path.join(root,'LICENSE'),path.join(folder,'LICENSE'));
writeFileSync(path.join(folder,'Diagnose.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-render-startup.ps1"\r\npause\r\n');
writeFileSync(path.join(folder,'README.txt'),'AVHub startup diagnostic kit, not an application update.\nClose AVHub first. Run Diagnose.cmd, select the actual AVHub.exe from the fully extracted app package, then select one of the two exact generated test-kit samples.\nSelect the same AVHub.exe used to reproduce the failure; the diagnostic kit itself does not contain that application.\nThe report is saved beside Diagnose.cmd. Share render-startup-*.json after checking private paths.\nOnly the separate diagnostic helper is executed; no runtime is installed or replaced, and source videos are read-only.\nIt tests DLL loading and direct D3D/libmpv startup, not the Electron compositor.\nsource/ contains the exact helper sources with expanded exception logging; LICENSE applies.\n');
writeFileSync(path.join(root,'build/render-startup-diagnostics-latest.json'),JSON.stringify({folder,scope:'Separate instrumented frozen-host startup probe, not app update or compositor acceptance'}));
console.log(folder);
