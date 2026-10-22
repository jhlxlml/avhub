import assert from 'node:assert/strict';
import {BoundsCalibration} from '../dist/boundsCalibration.js';
const target={x:348,y:104,width:658,height:274};
const c=new BoundsCalibration(target,2.4);
assert.deepEqual(c.observe({...target,width:659,height:275}),{...target,width:657,height:273});
assert.deepEqual(c.observe({...target,width:657,height:273}),target);
assert.equal(c.observe({...target,width:659,height:275}),null);
assert.equal(new BoundsCalibration(target,2.4).observe(target),null);
assert.equal(new BoundsCalibration(target,2.4).observe({...target,x:target.x+20}),null);
// Non-playback outer restoration retains exact calibration, with the original
// retry bound; no aspect preference is imposed on the library window.
const outer=new BoundsCalibration(target);
assert.deepEqual(outer.observe({...target,width:657}),{...target,width:659});
assert.equal(outer.observe(target),null);
const bounded=new BoundsCalibration(target);
for(let i=0;i<3;i++)assert.ok(bounded.observe({...target,width:657}));
assert.equal(bounded.observe({...target,width:657}),null);
// Portrait and wide candidates use per-edge gap, not width error alone.
const portrait=new BoundsCalibration({x:0,y:0,width:270,height:480},9/16);
assert.ok(portrait.observe({x:0,y:0,width:271,height:481}));
console.log('Bounds calibration passed: measured oscillation, finite retry, exact restore, portrait and OS reposition.');
