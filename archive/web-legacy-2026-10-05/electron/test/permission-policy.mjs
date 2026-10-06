import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { permissionAllowed } = require('../dist/permissionPolicy.js');
const origin = 'http://127.0.0.1:8765';
assert.equal(permissionAllowed('fullscreen', `${origin}/?video=1`, origin, true), true);
assert.equal(permissionAllowed('clipboard-sanitized-write', origin, origin, true), true);
for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read', 'fileSystem', 'automatic-fullscreen', 'loopback-network', 'unknown']) {
  assert.equal(permissionAllowed(permission, origin, origin, true), false);
}
for (const url of ['https://foreign.example', 'http://127.0.0.1:8766', 'file:///tmp/file', 'invalid'])
  assert.equal(permissionAllowed('fullscreen', url, origin, true), false);
assert.equal(permissionAllowed('fullscreen', origin, origin, false), false);
console.log('Permission policy passed: local main-frame fullscreen/path-copy allowed; unused permissions denied.');
