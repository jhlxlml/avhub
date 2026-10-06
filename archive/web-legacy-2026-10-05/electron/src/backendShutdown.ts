import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

export function waitForChildExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (exited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (result: boolean) => { clearTimeout(timer); child.removeListener('exit', onExit); resolve(result); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
    // Handle exit between the initial check and listener installation.
    if (exited(child)) finish(true);
  });
}

async function terminateOwnedTree(child: ChildProcess): Promise<void> {
  if (exited(child) || !child.pid) return;
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return; }
  // PID comes only from our spawned backend, never renderer input. PyInstaller
  // and FFmpeg can be children of it; killing just the parent leaves them alive.
  const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  await new Promise<void>(resolve => {
    const killer = spawn(command, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { killer.kill(); finish(); }, 2000);
    killer.once('error', finish); killer.once('exit', finish);
  });
  if (!exited(child)) child.kill();
}

export async function stopOwnedBackend(child: ChildProcess, origin: string, token: string, log: (message: string) => void): Promise<void> {
  if (exited(child)) return;
  const request = async (route: string, milliseconds: number) => {
    if (exited(child)) return;
    try {
      const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { 'X-AVHub-Token': token }, signal: AbortSignal.timeout(milliseconds) });
      await response.body?.cancel();
      if (!response.ok) log(`backend-shutdown-request ${route} status=${response.status}`);
    } catch (error) { log(`backend-shutdown-request ${route} ${String(error)}`); }
  };
  await request('/api/scan/pause', 1000);
  await request('/api/shutdown', 2000);
  if (await waitForChildExit(child, 7000)) { log('backend-stopped gracefully'); return; }
  log(`backend-force-stop owned-pid=${child.pid ?? 'unavailable'}`);
  await terminateOwnedTree(child);
  if (!await waitForChildExit(child, 1000)) log('backend-stop-unconfirmed');
}
