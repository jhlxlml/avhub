import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {renderHostTermination}=createRequire(import.meta.url)('../dist/renderHostTermination.js');
test('native status retains unsigned Windows fault code and known startup exception',()=>{
 const value=renderHostTermination(-1073741795,null,'DllNotFoundException: native host could not start',64);
 assert.equal(value.statusHex,'0xC000001D');assert.equal(value.startupException,'DllNotFoundException');
 assert.equal(renderHostTermination(0,null,'',0).statusHex,'0x00000000');
 assert.equal(renderHostTermination(null,'SIGTERM','',0).statusHex,null);
 assert.equal(renderHostTermination(-4058,null,'',0,'ENOENT').statusHex,null);
 assert.equal(renderHostTermination(-4058,null,'',0,'ENOENT').spawnError,'ENOENT');
});
test('diagnostics never copy arbitrary stderr paths or media names',()=>{
 const privateText='C:\\private\\movie.mp4: load failed';const value=renderHostTermination(1,null,privateText,privateText.length);
 assert.equal(value.startupException,null);assert.ok(!JSON.stringify(value).includes('movie.mp4'));
});
