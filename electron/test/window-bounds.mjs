import assert from 'node:assert/strict';
import {initialLibraryWindow} from '../dist/windowBounds.js';
for(const work of [
 {x:0,y:0,width:2560,height:1400},
 {x:0,y:0,width:1463,height:795},
 {x:-1536,y:-80,width:1536,height:824},
 {x:1920,y:400,width:680,height:480},
 {x:0,y:0,width:30,height:30},
]){
 const {bounds:b,minimum}=initialLibraryWindow(work);
 assert.ok(b.x>=work.x&&b.y>=work.y&&b.x+b.width<=work.x+work.width&&b.y+b.height<=work.y+work.height);
 assert.ok(b.width<=1440&&b.height<=900);assert.ok(minimum[0]<=b.width&&minimum[1]<=b.height);
}
assert.deepEqual(initialLibraryWindow({x:0,y:0,width:2560,height:1400}).bounds,{x:560,y:250,width:1440,height:900});
console.log('Initial window bounds passed: small/high-DPI, negative display coordinates and minimum sizes.');
