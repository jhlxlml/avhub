// Explicit renderer harness. Native track restoration is separately accepted
// with a real Electron/MPV process in electron/test/native-player.mjs.
import {test,expect} from '@playwright/test';
import {revealPlayerControls} from './player-pointer';
import {waitForDecodedPlayback} from './player-readiness';
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.patch('/api/preferences',{data:{values:{resumeBehavior:'restart'}}});});
async function subtitles(page:any){
  await revealPlayerControls(page);
  await page.getByRole('button',{name:'字幕',exact:true}).click();
}
test('remembering the sole audio track preserves original-file playback and the saved choice',async({page,request})=>{
  expect((await request.post('/test/sole-audio-fixture')).ok()).toBe(true);
  const media=await(await request.get('/api/media/2')).json();expect(media.audio_tracks).toHaveLength(1);
  const audio=media.audio_tracks[0].index,state=await(await request.get('/api/media/2/playback-state')).json();
  expect((await request.patch('/api/media/2/playback-state',{data:{source:state.source,changes:{audio}}})).ok()).toBe(true);
  const requests:any[]=[];page.on('request',r=>{if(r.url().endsWith('/api/media/2/playback')&&r.method()==='POST')requests.push(r.postDataJSON());});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/media/2/playback')&&r.request().method()==='POST');
  await page.goto('/?video=2');expect((await(await response).json()).mode).toBe('direct');await waitForDecodedPlayback(page);
  expect(requests).toHaveLength(1);expect(requests[0].audio_track_index).toBeUndefined();expect(requests[0].prefer_original).toBe(true);
  expect(requests[0].allow_video_transcode).not.toBe(true);expect(requests[0].allow_audio_transcode).not.toBe(true);
  await page.reload();await waitForDecodedPlayback(page);expect(requests).toHaveLength(2);expect(requests[1].audio_track_index).toBeUndefined();
  expect((await(await request.get('/api/media/2/playback-state')).json()).audio).toBe(audio);
});
test('sole audio normalization cannot override a real original-file decoder failure',async({page,request})=>{
  await request.post('/test/sole-audio-fixture');
  const media=await(await request.get('/api/media/2')).json(),state=await(await request.get('/api/media/2/playback-state')).json();
  await request.patch('/api/media/2/playback-state',{data:{source:state.source,changes:{audio:media.audio_tracks[0].index}}});
  await page.route('**/media/2/file',r=>r.fulfill({status:500,body:'isolated original-file failure'}));
  const attempts:any[]=[];page.on('response',async r=>{if(r.url().endsWith('/api/media/2/playback')&&r.request().method()==='POST')attempts.push({request:r.request().postDataJSON(),body:await r.json()});});
  await page.goto('/?video=2');await waitForDecodedPlayback(page);expect(attempts).toHaveLength(2);
  expect(attempts[0].body.mode).toBe('direct');expect(attempts[1].request.skip_direct).toBe(true);expect(attempts[1].body.mode).toBe('remux');
  expect(attempts.every(a=>!a.request.allow_video_transcode&&!a.request.allow_audio_transcode)).toBe(true);
});
test('restored non-default audio on multi-track media still requests actual track selection',async({page,request})=>{
  expect((await request.post('/test/two-audio-fixture')).ok()).toBe(true);
  const media=await(await request.get('/api/media/2')).json();expect(media.audio_tracks).toHaveLength(2);
  const audio=media.audio_tracks[1].index,state=await(await request.get('/api/media/2/playback-state')).json();
  expect((await request.patch('/api/media/2/playback-state',{data:{source:state.source,changes:{audio}}})).ok()).toBe(true);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/media/2/playback')&&r.request().method()==='POST');
  await page.goto('/?video=2');const r=await response;
  expect(r.request().postDataJSON().audio_track_index).toBe(audio);expect((await r.json()).mode).toBe('remux');
  await waitForDecodedPlayback(page);expect((await(await request.get('/api/media/2/playback-state')).json()).audio).toBe(audio);
});
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

for(const fail of [false,true])test(`pending track memory does not delay durable progress; navigation still waits (${fail?'failure/retry':'success'})`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{audio:{volume:0,muted:true}}}});
  await page.goto('/?video=3');await waitForDecodedPlayback(page);
  let release!:()=>void,reject=fail,memoryWrites=0;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/media/3/playback-state',async route=>{
    if(route.request().method()!=='PATCH')return route.continue();
    memoryWrites++;await gate;
    return reject?route.fulfill({status:503,json:{detail:'owned memory failure'}}):route.continue();
  });
  try{
    await subtitles(page);await page.getByRole('combobox',{name:'字幕轨道',exact:true}).selectOption('embedded:2');
    await expect.poll(()=>memoryWrites).toBe(1);await page.keyboard.press('Escape');
    const progress=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/media/3/progress'&&r.request().method()==='PUT',{timeout:2000});
    await page.locator('video').evaluate((v:HTMLVideoElement)=>v.pause());
    expect((await progress).ok()).toBe(true);
    expect((await(await request.get('/api/media/3')).json()).progress).toBeGreaterThan(0);
    await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
    await expect(page.getByRole('button',{name:'正在保存…',exact:true})).toBeVisible();
    await expect(page.locator('.player-shell')).toHaveCount(1);
    release();
    if(fail){
      await expect(page.locator('.player-shell .notice[role="alert"]')).toContainText('进度已保存，但播放记忆尚未保存');await expect(page.locator('.player-shell')).toHaveCount(1);
      reject=false;await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
    }
    await expect(page.locator('.player-shell')).toHaveCount(0);
    expect((await(await request.get('/api/media/3/playback-state')).json()).subtitle).toBe('embedded:2');
    expect(memoryWrites).toBe(fail?3:1);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
