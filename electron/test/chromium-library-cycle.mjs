// Acceptance-only observation. No source/codec changes or forced collection.
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {classifyChromiumWaits} from './chromium-cycle-observer.mjs';
export {classifyChromiumWaits,installChromiumCycleObserver} from './chromium-cycle-observer.mjs';

// Initial waiting is expected while loading a source. Keep it distinct from
// interruptions after playback or during a requested seek; never hide it.
export async function chromiumLibraryCycle(page,item,openStart){
 const video=page.locator('.player-shell video');
 await expect.poll(()=>page.evaluate(()=>window.__chromiumLibraryCycle.snapshot().firstFrameMs),{timeout:30000}).not.toBeNull();
 await expect.poll(()=>video.evaluate(v=>!v.paused&&v.readyState>=2&&v.getVideoPlaybackQuality().totalVideoFrames>0),{timeout:15000}).toBe(true);
 const openMs=Math.round(performance.now()-openStart);
 const originalSrc=await video.getAttribute('src');
 await page.waitForTimeout(10000);
 // Exercise real application shortcuts, not a direct currentTime assignment.
 await page.keyboard.press('Space');await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
 const target=await video.evaluate(v=>Math.min(v.duration-.1,v.currentTime+5));
 const seekStarted=await page.evaluate(()=>performance.now());await page.keyboard.press('ArrowRight');
 await expect.poll(()=>page.evaluate(({target,seekStarted})=>{
   const last=window.__chromiumLibraryCycle.snapshot().lastFrame;
   return Boolean(last&&last.at>=seekStarted&&Math.abs(last.mediaTime-target)<.5);
 },{target,seekStarted}),{timeout:20000,message:'seek must produce a newly decoded frame at the requested time'}).toBe(true);
 const state=await page.evaluate(()=>window.__chromiumLibraryCycle.snapshot());
 const quality=await video.evaluate(v=>({total:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames,width:v.videoWidth,height:v.videoHeight}));
 assert.equal(quality.width,item.width);assert.equal(quality.height,item.height);
 assert.equal(await video.getAttribute('src'),originalSrc,'seek must retain the original source');
 assert.equal(state.sourceLoads,1,'one original load, no seek fallback/reload');
 assert.equal(state.events.some(event=>event.name==='error'),false);
 return {engine:'chromium',openMs,firstFrameMs:state.firstFrameMs,sourceLoads:state.sourceLoads,
   bufferingEvents:state.events.filter(event=>event.name==='waiting').length,
   waitingByPhase:classifyChromiumWaits(state.events),
   stalled:state.events.filter(event=>event.name==='stalled').length,dropped:quality.dropped,decodedFrames:quality.total,
   seekMs:state.lastFrame.at-seekStarted,target,position:state.lastFrame.mediaTime,events:state.events};
}
