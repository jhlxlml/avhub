import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'build/libmpv-render-spike/budget-tests');mkdirSync(folder,{recursive:true});
const executable=path.join(folder,'MemoryBudgetTests.exe');
const args=['/nologo','/platform:x64','/target:exe','/main:MemoryBudgetTests','/out:'+executable,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...['MemoryBudgetTests.cs','RenderHost.cs','SharedSurface.cs','DisplayProbe.cs','RenderSurface.cs','D3dSurface.cs'].map(n=>path.join(import.meta.dirname,n))];
const compiled=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',args,{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
const result=spawnSync(executable,[],{windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim());
