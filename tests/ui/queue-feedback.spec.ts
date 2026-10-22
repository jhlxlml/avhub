// Renderer/decoder harness. Desktop visual acceptance runs in real Electron.
import {test,expect} from '@playwright/test';
import {answerResumeOrWaitForControls,waitForDecodedPlayback} from './player-readiness';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: queue failure retries without reloading the current decoder`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'},audio:{volume:0,muted:true}}}});
  let fail=true;await page.route('**/api/media/2/siblings?**',route=>fail?route.fulfill({status:503,json:{detail:'测试：队列读取失败'}}):route.continue());
  await page.goto('/?video=2');await answerResumeOrWaitForControls(page);await waitForDecodedPlayback(page);
  const video=page.locator('video'),source=await video.evaluate((v:HTMLVideoElement)=>v.currentSrc);
  const trigger=page.getByRole('button',{name:'展开待播队列',exact:true});await trigger.click();
  const queue=page.getByRole('region',{name:'待播队列',exact:true});await expect(queue.getByRole('alert')).toContainText('队列读取失败');
  await expect(queue.getByRole('combobox',{name:'播放模式',exact:true})).toHaveCSS('height','32px');
  await expect(queue.getByRole('combobox',{name:'播放模式',exact:true})).toHaveAccessibleDescription(/全局播放偏好/);
  await page.setViewportSize({width:390,height:820});expect(await queue.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await queue.scrollIntoViewIfNeeded();await page.screenshot({path:`build/queue-feedback-${theme}.png`});
  fail=false;const recovered=page.waitForResponse(response=>response.url().includes('/api/media/2/siblings?')&&response.status()===200);
  await queue.getByRole('button',{name:'重试待播队列',exact:true}).focus();await page.keyboard.press('Enter');
  const result=await(await recovered).json();expect(result.items.length).toBeGreaterThan(0);expect(result.items.length).toBeLessThanOrEqual(40);
  await expect(queue.getByRole('alert')).toHaveCount(0);await expect(queue.locator('li')).toHaveCount(result.items.length);
  await expect(queue.getByRole('button',{name:'队列播放 视频 002',exact:true})).toHaveAttribute('aria-current','true');
  expect(await video.evaluate((v:HTMLVideoElement)=>v.currentSrc)).toBe(source);await waitForDecodedPlayback(page);
});
