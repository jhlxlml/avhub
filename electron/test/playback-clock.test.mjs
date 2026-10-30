import test from 'node:test';import assert from 'node:assert/strict';
import {playbackClock} from '../dist/playbackClock.js';

test('pause, hide and close release the owned request without duplicate native calls',()=>{
 const calls=[],clock=playbackClock(period=>{calls.push(['begin',period]);return 0;},period=>{calls.push(['end',period]);return 0;});
 clock.setActive(false);clock.setActive(true);clock.setActive(true);clock.setActive(false);clock.setActive(false);
 clock.setActive(true);clock.setActive(false);
 assert.deepEqual(calls,[['begin',1],['end',1],['begin',1],['end',1]]);
 assert.deepEqual(clock.snapshot(),{active:false,available:true,requests:2,releases:2,lastResult:0});
});
test('an unsupported request keeps ordinary timing and is not retried every frame',()=>{
 let begins=0,ends=0;const clock=playbackClock(()=>{begins++;return 97;},()=>{ends++;return 0;});
 clock.setActive(true);clock.setActive(true);clock.setActive(false);clock.setActive(true);
 assert.equal(begins,1);assert.equal(ends,0);assert.equal(clock.snapshot().active,false);assert.equal(clock.snapshot().available,false);
});
test('a failed release is retained as owned and can be retried during drain',()=>{
 let ends=0;const clock=playbackClock(()=>0,()=>++ends===1?97:0);
 clock.setActive(true);clock.setActive(false);assert.equal(clock.snapshot().active,true);
 clock.setActive(false);assert.equal(clock.snapshot().active,false);assert.equal(clock.snapshot().requests,clock.snapshot().releases);
});
