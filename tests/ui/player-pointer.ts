import {expect,type Page} from '@playwright/test';

// Hidden controls intentionally reject hit testing. Move through the real
// hotzone first; never force-click through the video picture.
export async function revealPlayerControls(page:Page){
  const controls=page.locator('.player-controls');
  await controls.scrollIntoViewIfNeeded();
  const box=(await controls.boundingBox())!;
  await page.mouse.move(box.x+4,box.y+4);
  await page.mouse.move(box.x+box.width/2,box.y+box.height-6);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
}
