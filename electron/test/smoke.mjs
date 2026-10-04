import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const buildRoot = path.join(projectRoot, 'build');
mkdirSync(buildRoot, { recursive: true });
const tempRoot = mkdtempSync(path.join(buildRoot, 'electron-smoke-'));
const dataDir = path.join(tempRoot, 'profile-and-data');
const desktopLog = path.join(dataDir, 'desktop.log');
const electronExe = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const output = [];
let child;

function readLog() {
  try { return readFileSync(desktopLog, 'utf8'); } catch { return ''; }
}

function assertHealth(port) {
  return fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) })
    .then(async response => {
      assert.equal(response.ok, true, 'local API should answer successfully');
      const health = await response.json();
      assert.equal(health.ok, true);
      assert.equal(health.port, port);
      assert.equal(health.frozen, false);
      assert.equal(health.desktop_session, true);
      assert.equal(health.ffmpeg, true);
      assert.equal(health.ffprobe, true);
    });
}

async function waitFor(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (child && child.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode}) while waiting for ${label}`);
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  assert.ok(existsSync(electronExe), `Electron runtime missing: ${electronExe}`);
  child = spawn(electronExe, ['.', '--in-process-gpu', '--disable-gpu', '--no-sandbox'], {
    cwd: projectRoot,
    env: { ...process.env, AVHUB_DATA_DIR: dataDir, AVHUB_SMOKE_TEST: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  const exitPromise = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));

  await waitFor(() => /backend-ready port=(\d+)/.test(readLog()), 'backend readiness');
  const port = Number(readLog().match(/backend-ready port=(\d+)/)?.[1]);
  assert.ok(port > 0 && port < 65536, `invalid backend port: ${port}`);
  await assertHealth(port);
  await waitFor(() => readLog().includes('renderer-loaded'), 'renderer load');
  const result = await Promise.race([
    exitPromise,
    delay(30_000).then(() => { throw new Error('Electron did not exit after smoke-test renderer load'); }),
  ]);
  assert.equal(result.code, 0, `Electron exited with ${result.code} (${result.signal ?? 'no signal'})`);

  const log = readLog();
  for (const entry of ['startup-begin', 'backend-start', 'backend-ready', 'window-created', 'renderer-loaded', 'shutdown-start', 'shutdown-complete']) {
    assert.ok(log.includes(entry), `desktop log missing ${entry}`);
  }
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }),
    'backend should stop after Electron exits',
  );
  console.log(`Electron smoke passed: backend ${port}, renderer loaded, backend stopped cleanly.`);
  rmSync(tempRoot, { recursive: true, force: true });
} catch (error) {
  if (child && child.exitCode === null) {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  console.error(error instanceof Error ? error.stack : String(error));
  console.error(`Smoke data retained for diagnosis: ${tempRoot}`);
  if (output.length) console.error(output.join(''));
  process.exitCode = 1;
}
