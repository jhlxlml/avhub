// Compile the application-owned helper only. This does not package/release AVHub.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'build/native-render');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Native render host requires Windows x64');
const sources=['MpvCore.cs','D3dSurface.cs','RenderHost.cs','DisplayProbe.cs'].map(n=>path.join(root,'electron/native/render',n));
mkdirSync(output,{recursive:true});const host=path.join(output,'AVHubNativeRender.exe');
execFileSync(path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/platform:x64','/target:exe',`/out:${host}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...sources],{cwd:root,windowsHide:true,stdio:'inherit'});
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(path.join(output,'runtime.json'),JSON.stringify({protocol:1,platform:'win32-x64',hostSha256:hash(host),dllSha256:JSON.parse(readFileSync(path.join(root,'ci/libmpv-d3d11-candidate.json'))).dllSha256,sources:sources.map(file=>({name:path.relative(root,file).replaceAll('\\','/'),sha256:hash(file)})),productionDistributionReady:false},null,2));
console.log('Native render helper compiled; production packaging is not enabled.');
