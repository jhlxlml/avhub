import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const { waitForChildExit, stopOwnedBackend } = createRequire(import.meta.url)('../dist/backendShutdown.js');

const fake = () => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
const alreadyExited = fake(); alreadyExited.signalCode = 'SIGTERM';
assert.equal(await waitForChildExit(alreadyExited, 20), true);
const timedOut = fake(); assert.equal(await waitForChildExit(timedOut, 20), false);
assert.equal(timedOut.listenerCount('exit'), 0);
const completes = fake(); setTimeout(() => { completes.exitCode = 0; completes.emit('exit'); }, 10);
assert.equal(await waitForChildExit(completes, 100), true);
assert.equal(completes.listenerCount('exit'), 0);

// A real owned process tree that refuses the HTTP shutdown request. No app,
// library or video is involved; only these two test Node processes are killed.
const child = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');
const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
console.log(descendant.pid);setInterval(()=>{},1000);`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let descendant;
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const logs = [];
try {
  descendant = await new Promise(resolve => child.stdout.once('data', data => resolve(Number(data.toString().trim()))));
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
  const start = Date.now();
  await stopOwnedBackend(child, `http://127.0.0.1:${server.address().port}`, 'test-only-token', message => logs.push(message));
  assert.ok(Date.now() - start < 12000, 'owned tree termination must be bounded');
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.ok(logs.some(line => line.startsWith('backend-force-stop')));
  if (process.platform === 'win32') assert.throws(() => process.kill(descendant, 0), 'Windows descendant must not survive its owned backend');
  console.log('Shutdown policy passed: deadline/listener cleanup, graceful state detection and bounded termination of an owned Windows process tree.');
} finally {
  if (child.exitCode === null && child.signalCode === null) await stopOwnedBackend(child, `http://127.0.0.1:${server.address().port}`, 'test-only-token', () => {});
  if (process.platform !== 'win32' && descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} }
  server.close();
}
