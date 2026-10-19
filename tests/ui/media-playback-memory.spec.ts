// Explicit renderer harness. Native track restoration is separately accepted
// with a real Electron/MPV process in electron/test/native-player.mjs.
import {test,expect} from '@playwright/test';
import {revealPlayerControls} from './player-pointer';
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{resumeBehavior:'restart'}}});});
async function subtitles(page:any){
  await revealPlayerControls(page);
  await page.getByRole('button',{name:'字幕',exact:true}).click();
}
test('source-bound subtitles and delay restore without overwriting MPV-only choices',async({page,request})=>{
  const state=await(await request.get('/api/media/3/playback-state')).json();
  expect((await request.patch('/api/media/3/playback-state',{data:{source:state.source,changes:{subtitle:'embedded:2',delay:.6}}})).ok()).toBe(true);
  await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2),{timeout:30000}).toBe(true);
  await subtitles(page);await expect(page.getByRole('combobox',{name:'字幕轨道',exact:true})).toHaveValue('embedded:2',{timeout:30000});
  expect((await(await request.get('/api/media/3/playback-state')).json()).delay).toBe(.6);
  await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption('');
  await expect.poll(async()=>(await(await request.get('/api/media/3/playback-state')).json()).subtitle).toBe('');
  await page.reload();await expect(page.locator('video')).toBeVisible();await subtitles(page);
  await expect(page.getByRole('combobox',{name:'字幕轨道',exact:true})).toHaveValue('');
});
test('transient write failure retains pending choice and retries before leaving',async({page,request})=>{
  let reject=true;
  await page.route('**/api/media/3/playback-state',async route=>{
    if(route.request().method()==='PATCH'&&reject)return route.fulfill({status:503,json:{detail:'isolated test write failure'}});
    return route.continue();
  });
  await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2),{timeout:30000}).toBe(true);
  await subtitles(page);await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption('embedded:2');
  await expect(page.getByText(/播放记忆未保存：isolated test write failure/)).toBeVisible({timeout:30000});
  reject=false;await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('video')).toHaveCount(0);
  expect((await(await request.get('/api/media/3/playback-state')).json()).subtitle).toBe('embedded:2');
});

test('source replacement retires stale choices without blocking navigation or writing new tracks',async({page,request})=>{
  const initial=await(await request.get('/api/media/3/playback-state')).json();
  let changed=false,writes=0;
  await page.route('**/api/media/3/playback-state',route=>{
    if(route.request().method()==='PATCH'){
      writes++;changed=true;
      return route.fulfill({status:409,json:{detail:'源视频或轨道已变化，未覆盖播放记忆'}});
    }
    return changed?route.fulfill({json:{...initial,source:'a'.repeat(64),subtitle:null,delay:0}}):route.continue();
  });
  await page.goto('/?video=3');await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState>=2),{timeout:30000}).toBe(true);
  await subtitles(page);await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption('embedded:2');
  await expect(page.getByText(/源视频已变化，本次播放记忆未套用到新文件/)).toBeVisible();
  await page.keyboard.press('Escape');await page.locator('.player-top').getByRole('button',{name:/返回媒体库/}).click();
  await expect(page.locator('video')).toHaveCount(0);expect(writes).toBe(1);
});
