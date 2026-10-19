// Offline verification only. Never downloads, packages, publishes or rewrites a
// sign-off. Release readiness is deliberately separate from decoder unit tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(path.join(root,'electron/mpv-runtime.json'),'utf8'));
assert.equal(manifest.schema,1);
for(const key of ['archiveSha256','exeSha256','licenseSha256'])assert.match(manifest[key],/^[a-f0-9]{64}$/);
assert.match(manifest.asset,/^mpv-[\w.-]+\.zip$/);
assert.equal(manifest.url,`https://github.com/mpv-player/mpv/releases/download/git-release/${manifest.asset}`);
if(!process.argv.includes('--manifest-only')){
  for(const [file,key] of [['mpv.exe','exeSha256'],['LICENSE.GPL','licenseSha256']])assert.equal(createHash('sha256').update(readFileSync(path.join(root,'bin/mpv',file))).digest('hex'),manifest[key],`${file} checksum mismatch`);
}
console.log(JSON.stringify({status:manifest.status,runtimeVerified:!process.argv.includes('--manifest-only'),distributionReady:manifest.distributionReady,releaseBlockers:manifest.releaseBlockers},null,2));
if(process.argv.includes('--release'))assert.equal(manifest.distributionReady,true,'MPV release gate is closed: resolve and review the listed blockers; do not bundle the preview runtime');
