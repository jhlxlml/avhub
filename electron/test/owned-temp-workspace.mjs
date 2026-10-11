import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

// Node realpathSync can retain RUNNER~1 while Python's Path.resolve expands it.
// Use the backend's normalization for NEW owned fixtures only, before creating
// any media or comparing UI labels/Recycle Bin original-directory properties.
export function ownedTemporaryWorkspace(prefix){
  assert.match(prefix,/^avhub-[a-z-]+$/);
  const created=mkdtempSync(path.join(tmpdir(),prefix));
  if(process.platform!=='win32')return realpathSync(created);
  const result=spawnSync(process.env.AVHUB_PYTHON||'python',['-c','from pathlib import Path;import sys;print(Path(sys.argv[1]).resolve())',created],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PYTHONUTF8:'1'}});
  assert.equal(result.status,0,result.stderr||'Owned fixture canonicalization failed');
  const resolved=result.stdout.trim();assert.ok(path.isAbsolute(resolved));assert.equal(path.basename(resolved),path.basename(created));assert.ok(statSync(resolved).isDirectory());
  return resolved;
}
