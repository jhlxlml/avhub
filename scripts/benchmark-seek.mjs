import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const source = option('--source', undefined);
const sourceIndex = option('--source-index', undefined);
const sourceId = option('--source-id', '1');
const reference = option('--reference', undefined);
const mode = option('--mode', 'auto');
const legacyTs = args.includes('--legacy-ts');
const legacyRemux = args.includes('--legacy-remux');
const legacyDelivery=args.includes('--legacy-delivery');
const container=option('--container',undefined);
const audio=option('--audio','copy');
const measureBlank = args.includes('--measure-blank');
const withoutRetention = args.includes('--without-frame-retention');
if (!['auto','remux'].includes(mode)) throw new Error('--mode must be auto or remux');
const processes = [];
let browser;

async function start(kind, mediaSource) {
  const command = ['-B', 'tests/benchmark_server.py', '--kind', kind];
  if (mediaSource) command.push('--source', mediaSource);
  else if (kind === 'avhub' && sourceIndex) command.push('--source-index',path.resolve(sourceIndex),'--source-id',sourceId);
  if (reference) command.push('--reference-root', path.resolve(reference));
  if (kind==='avhub'&&container)command.push('--container',container,'--audio',audio);
  if (kind==='avhub'&&legacyDelivery)command.push('--legacy-delivery');
  const child = spawn(process.env.AVHUB_PYTHON || 'python', command, { cwd:project, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  const record = { child, url:null, error:'', exited:false };
  processes.push(record);
  child.stderr.on('data', chunk => { record.error += chunk.toString(); });
  child.on('exit', () => { record.exited = true; });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${kind} startup timed out: ${record.error}`)), 60000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try { const data = JSON.parse(line); record.url = data.url; clearTimeout(timer); resolve(data); return; }
        catch { /* Wait for a complete JSON line. */ }
      }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`${kind} exited ${code}: ${record.error}`)); });
  });
  const data = await ready;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (record.exited) throw new Error(record.error);
    try { if ((await fetch(`${data.url}/api/health`, { signal:AbortSignal.timeout(500) })).ok) return data; }
    catch { /* Socket is allocated before the ASGI service finishes starting. */ }
    await delay(100);
  }
  throw new Error(`${kind} API did not become ready`);
}

function summary(samples) {
  const sorted = samples.map(sample => sample.visibleMs??sample.ms).sort((a,b) => a-b);
  return sorted.length ? { samples:sorted.length, medianMs:Math.round(sorted[Math.floor(sorted.length / 2)]), p95Ms:Math.round(sorted[Math.ceil(sorted.length * .95) - 1]) } : null;
}

async function measure(server) {
  const page = await browser.newPage({ viewport:{width:1440,height:850} });
  const avhub = server.kind === 'avhub';
  const selector = avhub ? '.video-wrap video' : '#video';
  const result = { application:server.kind, status:'ok', mode:'original', firstFrameMs:null, decodedSize:null, seeks:[], summary:null };
  const network=await page.context().newCDPSession(page);
  await network.send('Network.enable');
  const mediaRequests=new Set();let receivedBytes=0;
  network.on('Network.requestWillBeSent',event=>{
    if(event.request.url.startsWith(`${server.url}/media/`))mediaRequests.add(event.requestId);
  });
  network.on('Network.dataReceived',event=>{
    if(mediaRequests.has(event.requestId))receivedBytes+=event.dataLength;
  });
  try {
    await page.addInitScript(measureBlank => {
      window.__seekBenchmark = { began:0, first:null, events:[], indicators:[], visual:[] };
      for(const name of ['waiting','stalled','seeking','seeked','loadstart','emptied'])document.addEventListener(name,event=>{
        if(event.target instanceof HTMLVideoElement)window.__seekBenchmark.events.push({name,at:performance.now(),time:event.target.currentTime,ready:event.target.readyState});
      },true);
      let indicator=null;
      new MutationObserver(()=>{
        const visible=document.querySelector('.video-wrap>.buffering,.video-wrap>.resume[role="status"]');
        const kind=visible?.classList.contains('buffering')?'buffering':visible?'preparing':null;
        if(indicator?.kind===kind)return;
        if(indicator)indicator.end=performance.now();
        indicator=kind?{kind,start:performance.now(),end:null}:null;
        if(indicator)window.__seekBenchmark.indicators.push(indicator);
      }).observe(document,{subtree:true,childList:true});
      if(measureBlank) {
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;
        const context=canvas.getContext('2d',{willReadFrequently:true});let interval=null;
        const sample=()=>{
          const video=document.querySelector('.video-wrap video,#video');let kind=null;
          const surface=document.querySelector('.video-wrap .seek-frame:not([hidden])');
          const retained=surface&&getComputedStyle(surface).display!=='none'&&getComputedStyle(surface).visibility!=='hidden'?surface:null;
          if(video) {
            if((video.readyState<2||!video.videoWidth)&&!retained)kind='no-frame';
            else if(context) {
              context.fillStyle='#000';context.fillRect(0,0,16,9);context.drawImage(retained??video,0,0,16,9);
              const pixels=context.getImageData(0,0,16,9).data;
              if(!pixels.some((channel,i)=>i%4!==3&&channel>1))kind='black-frame';
            }
          }
          if(interval?.kind!==kind) {
            if(interval)interval.end=performance.now();
            interval=kind?{kind,start:performance.now(),end:null}:null;
            if(interval)window.__seekBenchmark.visual.push(interval);
          }
          requestAnimationFrame(sample);
        };requestAnimationFrame(sample);
      }
      document.addEventListener('loadedmetadata', event => {
        if (event.target instanceof HTMLVideoElement && event.target.id === 'video') void event.target.play().catch(() => {});
      }, true);
      document.addEventListener('loadeddata', event => {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement) || window.__seekBenchmark.first !== null) return;
        video.requestVideoFrameCallback(() => {
          if (window.__seekBenchmark.first === null) window.__seekBenchmark.first = performance.now() - window.__seekBenchmark.began;
        });
      }, true);
    },measureBlank);
    if (avhub && (mode === 'remux'||legacyTs||legacyRemux)) await page.route('**/api/media/1/playback', route => route.continue({ postData:JSON.stringify({ ...route.request().postDataJSON(), ...(mode==='remux'?{prefer_original:false,skip_direct:true}:{}), ...(legacyTs?{indexed_ts:false}:{}), ...(legacyRemux?{indexed_remux:false}:{}) }) }));
    await page.goto(server.url);
    if(avhub&&withoutRetention)await page.addStyleTag({content:'.video-wrap .seek-frame{display:none!important}'});
    if (avhub) await page.getByRole('button', {name:'播放 播放基准样本',exact:true}).waitFor();
    else await page.locator('.card[data-id="1"]').waitFor();
    await page.evaluate(() => { window.__seekBenchmark.began = performance.now(); });
    if (avhub) await page.getByRole('button', {name:'播放 播放基准样本',exact:true}).click();
    else await page.locator('.card[data-id="1"]').click();
    await page.waitForFunction(() => window.__seekBenchmark.first !== null, undefined, {timeout:30000});
    result.firstFrameMs = Math.round(await page.evaluate(() => window.__seekBenchmark.first));
    result.decodedSize = await page.locator(selector).evaluate(video => `${video.videoWidth}×${video.videoHeight}`);
    if (avhub) {
      result.mode = await page.getByRole('button', {name:'画质',exact:true}).getAttribute('title');
      await page.locator('.playback-diagnostics summary').click();
    }
    for (const fraction of [.2,.75,.1,.9,.45,.6,.05,.8,.3,.95,.15,.5]) {
      const target = Math.round(server.duration * fraction * 10) / 10;
      const seekBegan=await page.evaluate(()=>performance.now());
      const bytesBefore=receivedBytes;
      if (avhub) {
        await page.getByRole('slider', {name:'视频完整进度'}).evaluate((input, value) => {
          input.value = String(value);
          input.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
        }, target);
        await page.waitForFunction(value => {
          const output = document.querySelector('output[aria-label="跳播耗时"]');
          return output?.getAttribute('data-target') === String(value) && /[\d.]+ (ms|秒)$/.test(output.textContent);
        }, target, {timeout:30000});
        const text = await page.getByLabel('跳播耗时').textContent();
        const match = text.match(/([\d.]+) (ms|秒)$/);
        result.seeks.push({target, ms:Number(match[1]) * (match[2] === '秒' ? 1000 : 1), path:text.split(' · ')[0]});
      } else {
        const ms = await page.locator(selector).evaluate((video, value) => new Promise((resolve,reject) => {
          const began = performance.now();
          let callback;
          const timer = setTimeout(() => { video.cancelVideoFrameCallback(callback); reject(new Error('seek frame timed out')); }, 30000);
          const presented = (_, frame) => {
            if (!video.seeking && video.readyState >= 2 && Math.abs(frame.mediaTime - value) < 1.5) {
              clearTimeout(timer); resolve(Math.round(performance.now() - began));
            } else callback = video.requestVideoFrameCallback(presented);
          };
          callback = video.requestVideoFrameCallback(presented);
          const scrub = document.getElementById('scrub');
          const box = scrub.getBoundingClientRect();
          scrub.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,clientX:box.left + box.width * value / video.duration}));
          window.dispatchEvent(new MouseEvent('mouseup'));
        }), target);
        result.seeks.push({target, ms, path:'原片按需读取'});
      }
      if(avhub&&measureBlank) {
        await page.locator('.seek-frame').waitFor({state:'hidden',timeout:30000});
        result.seeks.at(-1).visibleMs=await page.evaluate(since=>Math.round(performance.now()-since),seekBegan);
      }
      // Collect the real event/DOM feedback, not just the seeked event.
      await page.waitForTimeout(60);
      result.seeks.at(-1).receivedBytes=receivedBytes-bytesBefore;
      Object.assign(result.seeks.at(-1),await page.evaluate(since=>{
        const state=window.__seekBenchmark;
        return {waitingEvents:state.events.filter(e=>e.at>=since&&e.name==='waiting').length,
          sourceLoads:state.events.filter(e=>e.at>=since&&e.name==='loadstart').length,
          loadingIndicators:state.indicators.filter(i=>i.start>=since).length,
          noFrameMs:Math.round(state.visual.filter(i=>i.kind==='no-frame').reduce((sum,i)=>sum+Math.max(0,(i.end??performance.now())-Math.max(since,i.start)),0)),
          blackFrameMs:Math.round(state.visual.filter(i=>i.kind==='black-frame').reduce((sum,i)=>sum+Math.max(0,(i.end??performance.now())-Math.max(since,i.start)),0)),
          loadingVisibleMs:Math.round(state.indicators.reduce((sum,i)=>sum+Math.max(0,(i.end??performance.now())-Math.max(since,i.start)),0))};
      },seekBegan));
    }
    result.summary = summary(result.seeks);
    result.feedback=await page.evaluate(()=>({events:window.__seekBenchmark.events,indicators:window.__seekBenchmark.indicators}));
    result.frames = await page.locator(selector).evaluate(video => {
      const quality = video.getVideoPlaybackQuality();
      return { total:quality.totalVideoFrames, dropped:quality.droppedVideoFrames };
    });
  } catch (error) {
    result.status = 'incomplete'; result.error = String(error);
    result.pageText=await page.locator('body').innerText().catch(()=>null);
    result.summary = summary(result.seeks);
    result.runtime=await page.locator(selector).evaluate(video=>({time:video.currentTime,seeking:video.seeking,paused:video.paused,
      readyState:video.readyState,error:video.error?.message,source:video.currentSrc,
      diagnostics:document.querySelector('.playback-diagnostics')?.textContent,
      alert:document.querySelector('.video-wrap [role="alert"]')?.textContent})).catch(()=>null);
    result.feedback=await page.evaluate(()=>({events:window.__seekBenchmark.events,indicators:window.__seekBenchmark.indicators})).catch(()=>null);
  } finally { await page.close(); }
  return result;
}

try {
  const avhub = await start('avhub', source && path.resolve(source));
  const servers = [avhub];
  if (reference) servers.push(await start('reference', avhub.source));
  browser = await chromium.launch({ channel:'msedge', headless:true, args:['--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  for (const server of servers) results.push(await measure(server));
  const report = { createdAt:new Date().toISOString(), source:{name:path.basename(avhub.source), bytes:avhub.source_size, duration:avhub.duration, codec:avhub.codec}, requestedMode:mode, legacyTs, legacyRemux, legacyDelivery, container, audio, measureBlank, withoutRetention,
    limitations:['同一 Edge、同一视频、独立临时数据库；不修改源视频或日常媒体库。', '未清理操作系统文件缓存，应用按顺序运行；不代表冷盘性能。', '参考应用由基准脚本在元数据就绪时触发播放；两边预先缓存封面，不测量扫描或封面生成速度。', '合成视频只验证基准流程，不能代表实际 4K、长 GOP 或网络盘速度。'], results };
  const folder = path.join(project,'build','seek-benchmark'); mkdirSync(folder,{recursive:true});
  const destination = path.join(folder,`report-${Date.now()}.json`);
  writeFileSync(destination,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:destination, results:results.map(({application,status,mode,firstFrameMs,summary,seeks}) => ({application,status,mode,firstFrameMs,summary,
    loadingIndicators:seeks.reduce((sum,s)=>sum+(s.loadingIndicators??0),0),sourceLoads:seeks.reduce((sum,s)=>sum+(s.sourceLoads??0),0),
    noFrameMs:seeks.reduce((sum,s)=>sum+(s.noFrameMs??0),0),blackFrameMs:seeks.reduce((sum,s)=>sum+(s.blackFrameMs??0),0)}))},null,2));
  if (results.some(result => result.status !== 'ok')) process.exitCode = 1;
} finally {
  await browser?.close();
  // Stop the reference first: a generated source lives in the AVHub temporary profile.
  for (const record of processes.reverse()) {
    if (record.url) await fetch(`${record.url}/benchmark/shutdown`,{method:'POST',signal:AbortSignal.timeout(1500)}).catch(() => {});
    for (let attempt=0; !record.exited && attempt<50; attempt++) await delay(100);
    if (!record.exited) record.child.kill();
  }
}
