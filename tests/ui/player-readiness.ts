import {expect,type Page} from '@playwright/test';

// A ready/unpaused element can still be at frame zero. Save/quit tests need a
// real nonzero position, not a sleep or an assumption about decoder startup.
export async function waitForDecodedPlayback(page:Page){
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>
    v.readyState>=2&&!v.paused&&v.currentTime>.2&&v.getVideoPlaybackQuality().totalVideoFrames>0
  )).toBe(true);
}

// Observe both alternatives immediately. Waiting for a missing isEnabled()
// locator would block the poll and miss a resume prompt appearing meanwhile.
export async function answerResumeOrWaitForControls(page:Page){
  await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll<HTMLButtonElement>('button')].some(button=>
    button.getClientRects().length>0&&(button.textContent?.trim()==='从头开始'||button.getAttribute('aria-label')==='全屏'&&!button.disabled)
  ))).toBeTruthy();
  const restart=page.getByRole('button',{name:'从头开始',exact:true});
  if(await restart.isVisible())await restart.click();
}
