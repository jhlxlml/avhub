import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { appendBoundedLog } = createRequire(import.meta.url)('../dist/desktopLogs.js');
const build = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../build'); mkdirSync(build, {recursive:true});
const folder = mkdtempSync(path.join(build, 'log-policy-'));
try {
  writeFileSync(path.join(folder, 'library.db'), 'untouched');
  for (let i=0;i<10;i++) appendBoundedLog(folder, 'desktop.log', `entry-${i}-${'x'.repeat(30)}\n`, 80);
  assert.ok(readFileSync(path.join(folder, 'desktop.log'), 'utf8').includes('entry-9'));
  for (const name of ['desktop.log', 'desktop.log.1', 'desktop.log.2']) assert.ok(statSync(path.join(folder,name)).size <= 80);
  assert.equal(readdirSync(folder).filter(name=>name.startsWith('desktop.log')).length, 3);
  appendBoundedLog(folder, 'backend.log', Buffer.from('x'.repeat(200)), 80);
  assert.equal(statSync(path.join(folder,'backend.log')).size, 80);
  assert.equal(readFileSync(path.join(folder,'library.db'),'utf8'), 'untouched');
  appendBoundedLog(path.join(folder,'unavailable'), 'backend.log', 'no crash', 80);
  console.log('Desktop log policy passed: bounded current file, two rotated histories, oversized chunks, inaccessible folder and untouched library.');
} finally {
  assert.ok(folder.startsWith(build+path.sep)); rmSync(folder, {recursive:true,force:true});
}
