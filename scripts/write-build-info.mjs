import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['run.py', 'package.json', 'package-lock.json', 'requirements.txt', 'vite.config.ts', 'scripts/frontend-notices.mjs', 'scripts/write-build-info.mjs', 'app/sqlite-runtime.json'];
for (const directory of ['app', 'frontend/src', 'electron/src', 'electron/native']) {
  function collect(folder) {
    for (const entry of readdirSync(path.join(root, folder), {withFileTypes:true})) {
      const name=`${folder}/${entry.name}`;
      if (entry.isDirectory() && directory !== 'app') collect(name);
      else if (entry.isFile() && /\.(py|ts|tsx|css|cs)$/.test(entry.name)) files.push(name);
    }
  }
  collect(directory);
}
// Raw public inputs (fonts/images/licenses), never generated app/static output.
function publicAssets(folder){
  for(const entry of readdirSync(path.join(root,folder),{withFileTypes:true})){
    const name=`${folder}/${entry.name}`;
    if(entry.isDirectory())publicAssets(name);
    else if(entry.isFile())files.push(name);
  }
}
publicAssets('frontend/public');
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(file + '\0').update(readFileSync(path.join(root, file)));
const builtAt=process.env.AVHUB_BUILD_TIMESTAMP??new Date().toISOString();
if(!Number.isFinite(Date.parse(builtAt))||new Date(builtAt).toISOString()!==builtAt)throw new Error('AVHUB_BUILD_TIMESTAMP must be an ISO UTC timestamp');
const info = { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  api_protocol: 2, build_id: hash.digest('hex').slice(0, 16), built_at: builtAt };
writeFileSync(path.join(root, 'app', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`AVHub build ${info.version} / ${info.build_id}`);
