import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
assert.throws(()=>ownedTemporaryWorkspace('../not-owned'));
const parent=ownedTemporaryWorkspace('avhub-canonical-policy-');assert.ok(existsSync(parent));
if(process.platform==='win32'){
  const probe=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',"import ctypes,sys;f=ctypes.WinDLL('kernel32',use_last_error=True).GetShortPathNameW;f.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint32];f.restype=ctypes.c_uint32;b=ctypes.create_unicode_buffer(32768);n=f(sys.argv[1],b,len(b));print(b.value if n and n<len(b) else '')",parent],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PYTHONUTF8:'1'}});assert.equal(probe.status,0,probe.stderr);
  const short=probe.stdout.trim();assert.ok(short);
  const code="const {ownedTemporaryWorkspace}=await import(process.argv[1]);process.stdout.write(JSON.stringify({created:ownedTemporaryWorkspace('avhub-alias-child-')}));";
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,pathToFileURL(path.join(import.meta.dirname,'owned-temp-workspace.mjs')).href],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,TEMP:short,TMP:short,PYTHONUTF8:'1'}});assert.equal(child.status,0,child.stderr);
  const created=JSON.parse(child.stdout).created;assert.equal(path.dirname(created),parent);assert.ok(existsSync(created));assert.ok(path.basename(created).startsWith('avhub-alias-child-'));
  console.log(`Owned TEMP normalization passed with ${short===parent?'canonical':'8.3 alias'} TEMP; backend and fixture paths agree. No user media accessed.`);
}else console.log('Owned TEMP normalization passed; Windows alias case is platform-specific.');
