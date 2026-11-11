// Actual pinned libmpv API/ABI contract, not a desktop playback/performance test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),directory=mkdtempSync(path.join(root,'build/render-async-api-'));
const require=createRequire(import.meta.url),layout=require('../dist/renderRuntimeLayout.js').renderRuntimeLayout(root,false,'',process.env.AVHUB_RENDER_RUNTIME_CANDIDATE);
await require('../dist/renderHostClient.js').verifyRenderRuntime(layout);
const source=path.join(directory,'Contract.cs'),exe=path.join(directory,'Contract.exe');
writeFileSync(source,`using System;using System.Threading;using System.Web.Script.Serialization;
static class Contract {
 static MpvCore.PlayerEvent Reply(MpvCore core,ulong id){var clock=System.Diagnostics.Stopwatch.StartNew();while(clock.ElapsedMilliseconds<5000){var e=core.NextEvent();if(e.id==5&&e.userdata==id)return e;Thread.Sleep(1);}throw new Exception("Missing real command reply");}
 static void Main(string[] args){using(var core=new MpvCore(args[0],true)){
  core.CmdAsync(41,"seek","1","absolute+exact");var failed=Reply(core,41);if(failed.error>=0)throw new Exception("Seek without a source must fail asynchronously");
  core.CmdAsync(42,"set","pause","yes");var recovered=Reply(core,42);if(recovered.error<0)throw new Exception("Command after failed seek must recover");
  bool rejected=false;try{core.CmdAsync(43,"AVHUB_CONTRACT_INVALID_COMMAND");}catch(Exception){rejected=true;}if(!rejected)throw new Exception("Invalid registration must reject synchronously");
  Console.WriteLine(new JavaScriptSerializer().Serialize(new{failedReplyId=failed.userdata,failedCode=failed.error,recoveredReplyId=recovered.userdata,recoveredCode=recovered.error,registrationRejected=rejected}));
 }}
}`);
execFileSync(path.join(process.env.WINDIR??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+exe,'/r:System.Web.Extensions.dll',path.join(root,'electron/native/render/MpvCore.cs'),source],{windowsHide:true,cwd:root,stdio:'pipe'});
const result=JSON.parse(execFileSync(exe,[layout.dll],{windowsHide:true,cwd:directory,timeout:15000,encoding:'utf8'}));
assert.equal(result.failedReplyId,41);assert.ok(result.failedCode<0);assert.equal(result.recoveredReplyId,42);assert.ok(result.recoveredCode>=0);assert.equal(result.registrationRejected,true);
writeFileSync(path.join(directory,'report.json'),JSON.stringify({kind:'actual-libmpv-command-async-contract',runtime:layout.manifest,result,passed:true},null,2));console.log(path.join(directory,'report.json'));
