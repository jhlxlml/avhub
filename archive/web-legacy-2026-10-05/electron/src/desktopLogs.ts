import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export const LOG_BYTES = 4 * 1024 * 1024;
export function appendBoundedLog(directory: string, name: 'desktop.log' | 'backend.log', data: string | Buffer, maximum = LOG_BYTES) {
  if (!directory) return;
  const file = path.join(directory, name);
  let bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length > maximum) bytes = bytes.subarray(bytes.length - maximum);
  try {
    if (existsSync(file) && statSync(file).size + bytes.length > maximum) {
      // Only rotate the two app-owned log names. Keep two previous files;
      // never enumerate/delete a data directory or accept renderer paths.
      rmSync(file + '.2', { force:true });
      if (existsSync(file + '.1')) renameSync(file + '.1', file + '.2');
      renameSync(file, file + '.1');
    }
    appendFileSync(file, bytes);
  } catch { /* Read-only/full disks must not crash playback or shutdown. */ }
}
