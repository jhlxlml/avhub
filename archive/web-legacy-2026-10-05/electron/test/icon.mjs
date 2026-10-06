import assert from 'node:assert/strict';
import { _electron } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(root, 'build');
mkdirSync(build, { recursive: true });
const temporary = mkdtempSync(path.join(build, 'electron-icon-'));
let desktop;
try {
  const config = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).build;
  assert.equal(config.win.icon, 'electron/assets/avhub.ico');
  const ico = readFileSync(path.join(root, config.win.icon));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  const sizes = Array.from({ length: 7 }, (_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);

  // Simulate electron-builder's exact resource destination without packaging.
  const resource = config.extraResources.find(item => item.to === 'icons');
  assert.equal(resource.from, 'electron/assets');
  assert.deepEqual(resource.filter, ['avhub.png']);
  const resources = path.join(temporary, 'resources');
  mkdirSync(path.join(resources, resource.to), { recursive: true });
  copyFileSync(path.join(root, resource.from, 'avhub.png'), path.join(resources, resource.to, 'avhub.png'));

  desktop = await _electron.launch({
    args: ['.', '--in-process-gpu', '--disable-gpu', '--no-sandbox'], cwd: root,
    env: { ...process.env, AVHUB_DATA_DIR: path.join(temporary, 'data'), AVHUB_HEADLESS_TEST: '1', AVHUB_SMOKE_TEST: '0' },
    timeout: 60000,
  });
  const page = await desktop.firstWindow();
  await page.getByRole('button', { name: '媒体库设置' }).waitFor();
  const result = await desktop.evaluate(({ app }, locations) => {
    const load = process.getBuiltinModule('module').createRequire(locations.module);
    const icons = load(locations.module);
    const development = icons.loadDesktopIcon(app.getAppPath(), locations.resources, false);
    const packaged = icons.loadDesktopIcon('unused', locations.resources, true);
    let missingFails = false;
    try { icons.loadDesktopIcon('unused', locations.resources + '-missing', true); }
    catch { missingFails = true; }
    return {
      developmentPath: icons.desktopIconPath(app.getAppPath(), locations.resources, false),
      packagedPath: icons.desktopIconPath('unused', locations.resources, true),
      developmentSize: development.getSize(), packagedSize: packaged.getSize(),
      identical: development.toPNG().equals(packaged.toPNG()), missingFails,
    };
  }, { module: path.join(root, 'electron', 'dist', 'appIcon.js'), resources });
  assert.equal(result.developmentPath, path.join(root, 'electron', 'assets', 'avhub.png'));
  assert.equal(result.packagedPath, path.join(resources, 'icons', 'avhub.png'));
  assert.deepEqual(result.developmentSize, { width: 512, height: 512 });
  assert.deepEqual(result.packagedSize, result.developmentSize);
  assert.equal(result.identical, true);
  assert.equal(result.missingFails, true);
  const closed = desktop.waitForEvent('close', { timeout: 60000 });
  await desktop.evaluate(({ app }) => app.quit());
  await closed;
  desktop = undefined;
  console.log('AVHub icon: 7 ICO sizes, native PNG, development/packaged resource paths and desktop startup passed.');
} finally {
  if (desktop) await desktop.close();
  // Only remove this test's explicitly scoped, randomly generated directory.
  if (path.dirname(temporary) !== build || !path.basename(temporary).startsWith('electron-icon-'))
    throw new Error('Refusing unsafe temporary directory cleanup');
  rmSync(temporary, { recursive: true, force: true });
}
