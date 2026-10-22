// Explicit renderer harness: controlled transport failures, not desktop playback acceptance.
import {test,expect} from './transport-fixture';
test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('transient route GET retries twice without losing video or library filters',async({page})=>{
  let reads=0;
  await page.route('**/api/media/2',route=>++reads<3?route.abort('connectionreset'):route.continue());
  await page.goto('/?video=2&q=002&view=movies');
  // The player performs one separate detail refresh after restoration succeeds.
  await expect(page.locator('video')).toBeVisible();await expect.poll(()=>reads).toBe(4);
  await expect(page).toHaveURL(/video=2/);await expect(page).toHaveURL(/q=002/);
  await expect(page.getByRole('region',{name:'播放页恢复失败'})).toHaveCount(0);
});
test('exhausted reads preserve target and expose an explicit retry',async({page})=>{
  let reads=0,fail=true;
  await page.route('**/api/media/2',route=>{reads++;return fail?route.fulfill({status:503,json:{detail:'服务暂忙'}}):route.continue();});
  await page.goto('/?video=2');const recovery=page.getByRole('region',{name:'播放页恢复失败'});
  await expect(recovery).toContainText('服务暂忙');expect(reads).toBe(3);await expect(page).toHaveURL(/video=2/);
  expect(await page.locator('video').count()).toBe(0);
  fail=false;await recovery.getByRole('button',{name:'重试打开视频'}).click();
  await expect(page.locator('video')).toBeVisible();await expect.poll(()=>reads).toBe(5);
});
test('stalled GETs have bounded deadlines and stop after three attempts',async({page})=>{
  await page.clock.install();let reads=0;
  await page.route('**/api/media/2',()=>{reads++;return new Promise<void>(()=>{});});
  await page.goto('/?video=2');await expect.poll(()=>reads).toBe(1);
  await page.clock.runFor(5000);await page.clock.runFor(200);await expect.poll(()=>reads).toBe(2);
  await page.clock.runFor(5000);await page.clock.runFor(600);await expect.poll(()=>reads).toBe(3);
  await page.clock.runFor(5000);
  await expect(page.getByRole('region',{name:'播放页恢复失败'})).toContainText('本地服务响应超时');
  await page.clock.runFor(10000);expect(reads).toBe(3);await expect(page).toHaveURL(/video=2/);
});
for(const status of [404,403,409,422])test(`HTTP ${status} is not automatically retried`,async({page})=>{
  let reads=0;await page.route('**/api/media/2',route=>{reads++;return route.fulfill({status,json:{detail:'目标不可用'}});});
  await page.goto('/?video=2&q=002');const recovery=page.getByRole('region',{name:'播放页恢复失败'});
  await expect(recovery).toContainText('目标不可用');expect(reads).toBe(1);await expect(page).toHaveURL(/video=2/);
  await recovery.getByRole('button',{name:'返回媒体库'}).click();await expect(page).not.toHaveURL(/video=/);
  await expect(page.locator('.card')).toHaveCount(1);await expect(page).toHaveURL(/q=002/);
});
test('HTML/protocol mismatch is not treated as a transient server error',async({page})=>{
  let reads=0;await page.route('**/api/media/2',route=>{reads++;return route.fulfill({status:503,contentType:'text/html',body:'<!doctype html><html>wrong service</html>'});});
  await page.goto('/?video=2');await expect(page.getByRole('region',{name:'播放页恢复失败'})).toContainText('版本不匹配');expect(reads).toBe(1);
});
test('returning during pending recovery cancels further reads',async({page})=>{
  let reads=0;await page.route('**/api/media/2',route=>{reads++;return route.fulfill({status:503,json:{detail:'暂忙'}});});
  await page.goto('/?video=2');await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await expect(page).not.toHaveURL(/video=/);const count=reads;await page.waitForTimeout(1100);expect(reads).toBe(count);
  await expect(page.getByRole('region',{name:'播放页恢复失败'})).toHaveCount(0);
});
test('transient playlist reads keep the playlist route instead of silently switching context',async({page,request})=>{
  const list=await(await request.post('/api/playlists',{data:{name:'恢复片单'}})).json();
  await request.post(`/api/playlists/${list.id}/items`,{data:{media_id:2}});
  let reads=0;await page.route(`**/api/playlists/${list.id}/queue?**`,route=>{reads++;return route.fulfill({status:503,json:{detail:'片单暂忙'}});});
  await page.goto(`/?video=2&playlist=${list.id}`);await expect(page.getByRole('region',{name:'播放页恢复失败'})).toContainText('片单暂忙');
  expect(reads).toBe(3);await expect(page).toHaveURL(new RegExp(`playlist=${list.id}`));
});
for(const theme of ['dark','light'])test(`${theme}: narrow recovery card wraps technical errors and keeps actions visible`,async({page,request},info)=>{
 await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
 await page.setViewportSize({width:320,height:700});
 await page.route('**/api/media/2',route=>route.fulfill({status:404,json:{detail:'fixture-'.repeat(70)}}));
 await page.goto('/?video=2');const recovery=page.getByRole('region',{name:'播放页恢复失败'});
 await expect(recovery).toBeVisible();expect(await recovery.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(recovery.getByRole('button',{name:'重试打开视频'})).toBeInViewport();
 await expect(recovery.getByRole('button',{name:'返回媒体库'})).toBeInViewport();
 await recovery.screenshot({path:info.outputPath(`route-recovery-${theme}.png`)});
});
