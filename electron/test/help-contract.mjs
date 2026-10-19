// Help/keyboard contract only; never starts a decoder or an Electron window.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {playbackHelp} from '../../frontend/src/playbackHelp.ts';
import {playbackKeyIntent} from '../../frontend/src/playerShortcuts.ts';
const require=createRequire(import.meta.url),{independentInput}=require('../dist/independentInput.js');
const keys=mode=>new Set(playbackHelp(mode).groups.flatMap(g=>g.items.flatMap(([,keys])=>keys)));
for(const mode of ['chromium','embedded']){
 const documented=keys(mode);
 for(const [key,code] of [['K','KeyK'],['N','KeyN'],['W','KeyW'],['C','KeyC'],['F','KeyF'],['J','KeyJ'],['L','KeyL'],['M','KeyM'],['R','KeyR']]){
  assert.ok(documented.has(key));assert.ok(playbackKeyIntent({code,shiftKey:false}));
 }
}
assert.ok(keys('chromium').has('P'));assert.equal(keys('embedded').has('P'),false);
const native=independentInput(5),documented=keys('independent');
for(const [key,line] of [['PageUp','PGUP script-message avhub previous'],['PageDown','PGDWN script-message avhub next'],['C','c script-message avhub screenshot'],['Q','q script-message-to avhub_ui close']]){assert.ok(documented.has(key));assert.ok(native.includes(line));}
for(const key of ['N','W','P'])assert.equal(documented.has(key),false);
assert.ok(native.includes('WHEEL_UP add volume 2'));assert.match(playbackHelp('independent').mouse[0][1],/2%/);
assert.match(playbackHelp('independent').scope,/独立播放窗口/);assert.match(playbackHelp('embedded').capability,/暂不支持画中画/);
console.log('Help playback contract passed: mode-specific keys/capabilities match the current keyboard policy.');
