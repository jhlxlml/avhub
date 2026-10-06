import assert from 'node:assert/strict';
import {StartupTrace} from '../dist/startupTrace.js';
let now=10;const lines=[];
const trace=new StartupTrace(line=>lines.push(line),()=>now);
trace.mark('begin');now=60;trace.mark('backend-start');now=120;trace.mark('backend-ready');
now=150;trace.mark('library-ready');now=170;trace.mark('library-ready');
assert.equal(lines.length,4);assert.match(lines[1],/elapsed_ms=50$/);assert.match(lines[3],/elapsed_ms=140$/);
console.log('Startup trace passed: monotonic offsets and no duplicate ready events.');
