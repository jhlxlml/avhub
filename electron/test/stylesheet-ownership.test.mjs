// Source contract only; pixel/layout acceptance runs in Electron separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');

test('settings and playlists own presentation; lazy opening cannot reorder styles',()=>{
 const main=read('frontend/src/main.tsx'),mira=read('frontend/src/mira.css');
 for(const file of ['settings','playlists'])assert.ok(main.indexOf(`import './${file}.css'`)>main.indexOf("import './mira.css'"));
 assert.doesNotMatch(read('frontend/src/Settings.tsx'),/import ['"]\.\/settings\.css['"]/);
 assert.doesNotMatch(mira,/\.directory-setting-|\.settings-switch|\.playlist-item-actions/);
 for(const file of ['settings','playlists'])assert.match(read(`frontend/src/${file}.css`),/var\(--ui-control-height\)/);
 assert.match(read('frontend/src/design-system.css'),/--ui-control-height-compact:28px/);
});
