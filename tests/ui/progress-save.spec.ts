// Renderer/HTTP contract harness; real Electron acceptance is separate.
import {test,expect,type Page} from '@playwright/test';
import {answerResumeOrWaitForControls,waitForDecodedPlayback} from './player-readiness';
// This is a save/HTTP contract harness, not audio-device acceptance. Headless
// Edge's real audio sink can stall even a plain video element in this session.
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{audio:{volume:0,muted:true}}}});});
async function open(page:Page){
 await page.goto('/?video=2');await answerResumeOrWaitForControls(page);
 await waitForDecodedPlayback(page);
}
for(const fail of [false,true])test(`pause and back share one pending durable snapshot (${fail?'failure/retry':'success'})`,async({page,request})=>{
 await open(page);const source=await page.locator('video').getAttribute('src');let release!:()=>void,writes=0;
 const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/media/2/progress',async route=>{
  writes++;await gate;
  if(fail)await route.fulfill({status:500,json:{detail:'隔离保存失败'}});
  else await route.continue();
 });
 try{
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());await expect.poll(()=>writes).toBe(1);
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page.getByRole('button',{name:'正在保存…',exact:true})).toBeVisible();
  await page.waitForTimeout(150);expect(writes).toBe(1);await expect(page.locator('video')).toHaveAttribute('src',source!);
  release();
  if(fail){
   await expect(page.getByRole('alert')).toContainText('隔离保存失败');await expect(page).toHaveURL(/video=2/);
   await page.unrouteAll({behavior:'wait'});
   await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  }
  await expect(page.locator('.player-shell')).toHaveCount(0);
  expect((await(await request.get('/api/media/2')).json()).progress).toBeGreaterThan(0);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
test('completed progress is not cached: an explicit return still confirms persistence',async({page})=>{
 await open(page);let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/media/2/progress'&&r.method()==='PUT')writes++;});
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/media/2/progress'&&r.request().method()==='PUT');
 await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());expect((await saved).ok()).toBe(true);
 await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await expect(page.locator('.player-shell')).toHaveCount(0);expect(writes).toBe(2);
});
test('pagehide keepalive is not replaced by an ordinary pending fetch',async({page})=>{
 await open(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const stamps:number[]=[];
 await page.route('**/api/media/2/progress',async route=>{stamps.push(route.request().postDataJSON().updated_at);await gate;await route.continue();});
 try{
  await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());await expect.poll(()=>stamps.length).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect.poll(()=>stamps.length).toBe(2);
  expect(stamps[1]).toBeGreaterThan(stamps[0]);release();
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
