import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {fitPlaybackBounds,playbackMinimum}=createRequire(import.meta.url)('../dist/playbackGeometry.js');
for(const work of [{x:0,y:0,width:1920,height:1040},{x:-1280,y:40,width:1280,height:680},{x:2000,y:0,width:800,height:560}]) {
  for(const ratio of [16/9,9/16,4/3,2.4,1,1/64,64]) {
    for(const current of [{x:work.x+30,y:work.y+40,width:1440,height:900},{x:9999,y:-9999,width:320,height:900}]) {
      for(const largest of [false,true]) {
        const fitted=fitPlaybackBounds(current,work,ratio,largest);
        assert.ok(Math.abs(fitted.width-fitted.height*ratio)<=Math.max(1,ratio/2+.5));
        assert.ok(fitted.x>=work.x && fitted.y>=work.y);
        assert.ok(fitted.x+fitted.width<=work.x+work.width && fitted.y+fitted.height<=work.y+work.height);
        const min=playbackMinimum(ratio,work);assert.ok(fitted.width>=min[0]-1 && fitted.height>=min[1]-1);
      }
    }
  }
}
console.log('Playback geometry passed: landscape, portrait, square, ultrawide, extreme ratios, off-screen bounds, negative-coordinate monitors and small work areas.');
