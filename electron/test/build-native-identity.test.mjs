// Isolated tiny source fixture; never edits the actual native sources or metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
test('native host changes alter build identity; generated files and timestamps do not',()=>{
 const root=path.resolve(import.meta.dirname,'../..'),fixture=mkdtempSync(path.join(root,'build/build-native-identity-'));
 for(const folder of ['app','frontend/src','frontend/public','electron/src','electron/native/render','scripts'])mkdirSync(path.join(fixture,folder),{recursive:true});
 for(const file of ['run.py','package-lock.json','requirements.txt','vite.config.ts','scripts/frontend-notices.mjs','app/sqlite-runtime.json'])writeFileSync(path.join(fixture,file),'');
 writeFileSync(path.join(fixture,'package.json'),'{"version":"0.0.0"}');copyFileSync(path.join(root,'scripts/write-build-info.mjs'),path.join(fixture,'scripts/write-build-info.mjs'));
 const native=path.join(fixture,'electron/native/render/RenderHost.cs');writeFileSync(native,'// original host');
 const build=timestamp=>{const result=spawnSync(process.execPath,['scripts/write-build-info.mjs'],{cwd:fixture,encoding:'utf8',windowsHide:true,env:{...process.env,AVHUB_BUILD_TIMESTAMP:timestamp}});assert.equal(result.status,0,result.stderr);return JSON.parse(readFileSync(path.join(fixture,'app/build-info.json'),'utf8'));};
 const first=build('2026-11-12T00:00:00.000Z');writeFileSync(native,'// modified GPU wait');const changed=build('2026-11-12T00:00:00.000Z');assert.notEqual(changed.build_id,first.build_id);
 writeFileSync(path.join(fixture,'electron/native/render/temporary.exe'),'generated');const repeated=build('2026-11-12T00:01:00.000Z');assert.equal(repeated.build_id,changed.build_id);assert.notEqual(repeated.built_at,changed.built_at);
 writeFileSync(native,'// original host');assert.equal(build('2026-11-12T00:00:00.000Z').build_id,first.build_id);
});
