import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['run.py', 'package.json', 'vite.config.ts'];
for (const directory of ['app', 'frontend/src', 'electron/src']) {
  for (const name of readdirSync(path.join(root, directory)))
    if (/\.(py|ts|tsx|css)$/.test(name)) files.push(`${directory}/${name}`);
}
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(file + '\0').update(readFileSync(path.join(root, file)));
const info = { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  api_protocol: 2, build_id: hash.digest('hex').slice(0, 16), built_at: new Date().toISOString() };
writeFileSync(path.join(root, 'app', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`AVHub build ${info.version} / ${info.build_id}`);
