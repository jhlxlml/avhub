import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync,copyFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { get } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(root, 'build'); mkdirSync(build, { recursive: true });
const temporary = mkdtempSync(path.join(build, 'electron-shutdown-'));
const fixture = path.join(temporary, 'fixture'); mkdirSync(fixture);
const mp4 = path.join(fixture, 'Show.S01E01.mp4'), mkv = path.join(fixture, 'Show.S01E02.mkv');
const encode = args => {
  const result = spawnSync(path.join(root, 'bin', 'ffmpeg.exe'), ['-v', 'error', ...args], { windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr?.toString());
};
encode(['-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=5', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
encode(['-i', mp4, '-map', '0', '-c', 'copy', mkv]);
let desktop, held;
const results = [];
async function launch() {
  desktop = await _electron.launch({ args: [root, '--in-process-gpu', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'], cwd: temporary,
    env: { ...process.env, AVHUB_DATA_DIR: temporary, AVHUB_HEADLESS_TEST: '1', AVHUB_SMOKE_TEST: '0' }, timeout: 60000 });
  const page = await desktop.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const reads=[];
  page.on('response',response=>{
    if(!new URL(response.url()).pathname.startsWith('/api/'))return;
    reads.push({path:new URL(response.url()).pathname,status:response.status()});
    if(reads.length>50)reads.shift();
  });
  try{await page.getByRole('button', { name: '媒体库设置' }).waitFor();}
  catch(error){
    const evidence={url:page.url(),body:await page.locator('body').innerText().catch(()=>''),errors,reads,
      resources:await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>({name:row.name,duration:row.duration}))).catch(()=>[])};
    writeFileSync(path.join(temporary,'startup-failure.json'),JSON.stringify(evidence,null,2));
    await page.screenshot({path:path.join(temporary,'startup-failure.png')}).catch(()=>{});
    console.error('Shutdown restart failure state:',JSON.stringify(evidence));throw error;
  }
  return page;
}
async function revealControls(page){
  const controls=page.locator('.player-controls');await controls.scrollIntoViewIfNeeded();
  const box=await controls.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+4,box.y+4);
  await page.mouse.move(box.x+box.width/2,box.y+box.height-6);
  await expect(page.locator('.video-wrap')).not.toHaveClass(/controls-hidden/);
}
async function closeWindow(page, name) {
  const origin = new URL(page.url()).origin;
  // Click actionability/scheduling is not shutdown work. Keep the 4-second
  // application budget below, measured from the trusted main-process event.
  const rendererClosed = page.waitForEvent('close', { timeout: 8000 });
  const applicationClosed = desktop.waitForEvent('close', { timeout: 16000 }).then(() => true, () => false);
  const started = Date.now();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click().catch(error => { if (!page.isClosed()) throw error; });
  await rendererClosed;
  const clickToCloseMs = Date.now() - started;
  assert.equal(await applicationClosed, true, 'backend cleanup must be bounded'); desktop = null;
  const exitMs = Date.now() - started;
  held?.destroy(); held = null;
  await expect.poll(async () => {
    try { return !(await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return true; }
  }).toBe(true);
  const log = readFileSync(path.join(temporary, 'desktop.log'), 'utf8');
  const timestamp=event=>{const line=log.trim().split(/\r?\n/).filter(line=>line.endsWith(event)).at(-1);assert.ok(line,event);return Date.parse(line.split(' ')[0]);};
  const windowMs=timestamp('playback-window-released')-timestamp('shutdown-start');
  assert.ok(windowMs>=0&&windowMs<4000,`playback window must not wait for the server drain: ${windowMs} ms`);
  assert.ok(log.lastIndexOf('playback-window-released') < log.lastIndexOf('shutdown-complete'));
  results.push({ name, windowMs, clickToCloseMs, exitMs });
}

try {
  let page = await launch();
  await page.evaluate(async directory => {
    await fetch('/api/roots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: directory }) });
    await fetch('/api/scan', { method: 'POST' });
  }, fixture);
  await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/media?page=1&sort=name')).json()).total), { timeout: 30000 }).toBe(2);
  const episodes = await page.evaluate(async () => (await (await fetch('/api/media?page=1&sort=name')).json()).items);
  assert.ok(episodes.every(item => item.kind === 'episode'));
  // Preserve a valid MP4 header; trailing zeros provide a large, isolated HTTP
  // response. A paused Node reader then reproduces Uvicorn's open-stream drain.
  truncateSync(mp4, 128 * 1024 * 1024);
  const original = [statSync(mp4), statSync(mkv)].map(file => ({ size: file.size, mtime: file.mtimeMs }));
  await page.goto(new URL(`/?video=${episodes[0].id}`, page.url()).href);
  await expect.poll(() => page.locator('video').evaluate(v => v.readyState >= 2 && !v.paused), { timeout: 15000 }).toBe(true);
  await page.locator('video').evaluate(v => { v.currentTime = 12; });
  await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(12);
  const origin = new URL(page.url()).origin;
  const cookie = (await page.context().cookies(origin)).map(item => `${item.name}=${item.value}`).join('; ');
  await new Promise((resolve, reject) => {
    held = get(`${origin}/media/${episodes[0].id}/file`, { headers: { Cookie: cookie } }, response => {
      response.on('error', () => {}); response.pause(); assert.equal(response.statusCode, 200); resolve();
    });
    held.on('error', reject);
  });
  await closeWindow(page, 'playing episode + stalled original-file connection');
  page = await launch();
  const progress = await page.evaluate(async id => (await (await fetch(`/api/media/${id}`)).json()).progress, episodes[0].id);
  assert.ok(progress >= 12, `active episode progress must be saved: ${progress}`);
  await page.goto(new URL(`/?video=${episodes[1].id}`, page.url()).href);
  await expect.poll(() => page.locator('video').evaluate(v => v.readyState >= 2 && !v.paused), { timeout: 20000 }).toBe(true);
  // Exercise the real explicit-consent path on our generated fixture. The old
  // request rewrite correctly fails now that implicit lossy conversion is banned.
  await revealControls(page);
  await page.getByRole('button',{name:'画质',exact:true}).click();
  await page.getByRole('combobox',{name:'画质',exact:true}).selectOption('compat');
  const compatibility=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/media/${episodes[1].id}/playback`&&response.request().method()==='POST'&&response.request().postDataJSON()?.quality==='compat');
  await page.getByRole('dialog',{name:'启用有损兼容播放？',exact:true}).getByRole('button',{name:'接受并继续',exact:true}).click();
  const converted=await compatibility;assert.ok(converted.ok());assert.equal((await converted.json()).mode,'hls');
  assert.equal(converted.request().postDataJSON().allow_video_transcode,true);
  await expect.poll(() => page.locator('video').evaluate(v => v.readyState >= 2 && !v.paused && v.currentTime > 0), { timeout: 20000 }).toBe(true);
  await expect(page.getByRole('button', { name: '画质', exact: true })).toHaveAttribute('title', '画质：compat');
  assert.ok(readdirSync(path.join(temporary, 'hls')).some(name => /^[a-f0-9]{32}$/.test(name)));
  await revealControls(page);
  await page.getByRole('button', { name: '纯净播放', exact: true }).click();
  await closeWindow(page, 'playing MKV episode in pure mode + HLS/FFmpeg');
  assert.ok(!readdirSync(path.join(temporary, 'hls')).some(name => /^[a-f0-9]{32}$/.test(name)), 'active HLS cache must be retired on graceful exit');
  page = await launch();
  const saved = await page.evaluate(async id => (await (await fetch(`/api/media/${id}`)).json()).progress, episodes[1].id);
  assert.ok(saved > 0, 'HLS episode must have persisted its active playback progress');
  await page.route(`**/api/media/${episodes[1].id}/playback`, () => {}); // Intentionally pending until the window is destroyed.
  await page.goto(new URL(`/?video=${episodes[1].id}`, page.url()).href);
  await page.getByRole('button', { name: '从头开始', exact: true }).click();
  await expect(page.getByText('正在准备播放…', { exact: true })).toBeVisible();
  await closeWindow(page, 'episode with a pending playback request');
  page = await launch();
  assert.equal(await page.evaluate(async id => (await (await fetch(`/api/media/${id}`)).json()).progress, episodes[1].id), saved, 'closing during preparation must preserve previous progress');
  await closeWindow(page, 'idle restart after episode shutdown');
  const scanFolder=path.join(temporary,'scan-fixture');mkdirSync(scanFolder);
  // Clone only the small generated MKV, never the deliberately padded MP4.
  for(let i=0;i<120;i++)copyFileSync(mkv,path.join(scanFolder,`Scan.S01E${String(i+1).padStart(3,'0')}.mkv`));
  page=await launch();
  await page.evaluate(async directory=>{
    await fetch('/api/roots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory})});
    await fetch('/api/scan',{method:'POST'});
  },scanFolder);
  const scanBefore=await page.evaluate(async()=>(await(await fetch('/api/scan')).json()));
  assert.ok(['discovering','running'].includes(scanBefore.state),'must close during real active indexing');
  await closeWindow(page,'active metadata scan and background covers');
  page=await launch();
  const resumed=await page.evaluate(async()=>(await(await fetch('/api/scan')).json()));
  assert.equal(resumed.state,'interrupted','unfinished scan checkpoint must survive app quit');
  await closeWindow(page,'restart with interrupted metadata checkpoint');
  assert.deepEqual([statSync(mp4), statSync(mkv)].map(file => ({ size: file.size, mtime: file.mtimeMs })), original, 'source fixtures must not be changed by playback/shutdown');
  assert.ok(temporary.startsWith(build + path.sep)); rmSync(temporary, { recursive: true, force: true });
  console.log('Electron episode shutdown passed:', JSON.stringify(results));
} catch (error) {
  console.error(error); console.error(`Test data retained: ${temporary}`); process.exitCode = 1;
} finally {
  held?.destroy();
  if (desktop) {
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {});
    await desktop.close().catch(() => {});
  }
}
