// Explicit component harness; real Electron acceptance runs separately.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])for(const width of [390,1440])test(`${theme} ${width}px: shared switches and preference fields remain usable`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.setViewportSize({width,height:850});await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const preview=page.getByRole('checkbox',{name:'封面悬停预览',exact:true});
  await expect(preview).toHaveCSS('width','30px');await expect(preview).toHaveCSS('height','18px');
  const initial=await preview.isChecked();await preview.focus();await page.keyboard.press('Space');await expect(preview).toBeChecked({checked:!initial});
  await page.keyboard.press('Space');await expect(preview).toBeChecked({checked:initial});
  const thumbnail=page.getByRole('region',{name:'后台封面',exact:true});
  await expect(thumbnail.locator('.settings-section-heading button')).toBeVisible();
  await expect(thumbnail.locator('.thumbnail-task-summary>span').first()).toHaveCSS('border-top-width','0px');
  await page.screenshot({path:`build/ui-refinement/shared-settings-${theme}-${width}.png`});
  await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  const autoplay=page.getByRole('checkbox',{name:'视频连播',exact:true});await expect(autoplay).toHaveCSS('width','30px');
  await expect(autoplay).toHaveAttribute('aria-describedby',/.+/);await autoplay.focus();await page.keyboard.press('Space');
  await expect(autoplay).not.toBeChecked();
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values.autoNext).toBe(false);
  await expect(page.getByRole('combobox',{name:'起播方式',exact:true})).toHaveCSS('min-height','32px');
  if(width===1440){
    const engine=await page.getByRole('combobox',{name:'默认播放引擎',exact:true}).boundingBox();
    const resume=await page.getByRole('combobox',{name:'起播方式',exact:true}).boundingBox();
    expect(Math.abs(engine!.x-resume!.x)).toBeLessThanOrEqual(1);expect(Math.abs(engine!.width-resume!.width)).toBeLessThanOrEqual(1);
  }
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.getByRole('region',{name:'视频连播设置'}).screenshot({path:`build/ui-refinement/shared-autoplay-${theme}-${width}.png`});
  await page.getByText('高级播放设置',{exact:true}).click();const prepare=page.getByRole('checkbox',{name:'MKV 无损播放准备',exact:true});
  await expect(prepare).toHaveCSS('width','30px');await expect(prepare).not.toBeChecked();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'视频连播',exact:true})).not.toBeChecked();
});
