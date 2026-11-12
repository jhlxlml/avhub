// Read-only real-index baseline, NOT packaging and NOT an OS cold-cache test.
// The original DB is opened read-only; all changes occur in a NEW owned profile.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');const source=process.argv[2];
const artwork=process.argv.includes('--artwork');
assert.ok(source&&path.isAbsolute(source),'Provide an explicitly authorized read-only library DB.');
const workspace=mkdtempSync(path.join(root,'build/library-baseline-')),profile=path.join(workspace,'profile');mkdirSync(profile);
const cloned=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',`
import os,sqlite3,json,hashlib,shutil
from pathlib import Path
source=Path(os.environ['AVHUB_BASE_SOURCE']);target=Path(os.environ['AVHUB_BASE_TARGET'])
src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);dst=sqlite3.connect(target);src.backup(dst);src.close()
prefix='E:'+chr(92)+'downloads'+chr(92)
dst.execute('DELETE FROM media WHERE lower(substr(path,1,?))<>lower(?)',(len(prefix),prefix))
dst.execute('DELETE FROM roots WHERE id NOT IN (SELECT DISTINCT root_id FROM media)')
tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for name in ('thumbnail_jobs','file_operations','recycle_actions','source_changes','media_subtitle_links','scan_checkpoint','root_file_permissions','preferences'):
 if name in tables:dst.execute('DELETE FROM '+name)
covers=[]
if os.environ['AVHUB_BASE_ARTWORK']=='1':
 allowed=(source.parent/'thumbnails').resolve()
 for media_id,name in dst.execute('SELECT id,thumbnail FROM media ORDER BY created_at DESC,id DESC LIMIT 288'):
  if not name:continue
  relative=Path(name)
  if relative.is_absolute() or '..' in relative.parts or relative.parts[0]!='thumbnails' or relative.suffix.lower() not in ('.jpg','.jpeg','.png','.webp'):continue
  original=source.parent/name
  if original.is_symlink() or not original.is_file() or not original.resolve().is_relative_to(allowed) or original.stat().st_size>4*1024**2:continue
  output=target.parent/name;output.parent.mkdir(parents=True,exist_ok=True)
  with original.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
  shutil.copyfile(original,output)
  with output.open('rb') as stream:
   if hashlib.file_digest(stream,'sha256').hexdigest()!=digest:raise ValueError('Artwork copy changed')
  covers.append({'id':media_id,'sha256':digest,'bytes':output.stat().st_size})
 if not covers:raise ValueError('Real bounded cover inventory required')
else:dst.execute('UPDATE media SET thumbnail=NULL')
dst.execute('UPDATE media SET custom_cover=NULL')
dst.execute('INSERT OR REPLACE INTO thumbnail_control(id,paused) VALUES(1,1)')
dst.execute('DELETE FROM playlist_items WHERE media_id NOT IN (SELECT id FROM media)');dst.commit()
print(json.dumps({'videos':dst.execute('SELECT COUNT(*) FROM media').fetchone()[0],'roots':dst.execute('SELECT COUNT(*) FROM roots').fetchone()[0],'covers':covers}));dst.close()
`],{cwd:root,env:{...process.env,PYTHONIOENCODING:'utf-8',AVHUB_BASE_SOURCE:source,AVHUB_BASE_TARGET:path.join(profile,'library.db'),AVHUB_BASE_ARTWORK:artwork?'1':'0'},encoding:'utf-8',windowsHide:true,timeout:30000});
assert.equal(cloned.status,0,cloned.stderr);const counts=JSON.parse(cloned.stdout);assert.ok(counts.videos>1000);
let desktop;const launches=[],latencies=[],rendererCommits=[],scrollSamples=[];
try{
  for(let pass=0;pass<2;pass++){
    const start=performance.now();desktop=await _electron.launch({args:[root],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_HEADLESS_TEST:'0',AVHUB_SMOKE_TEST:'0'},timeout:60000});
    const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();await expect(page.locator('.card').first()).toBeVisible();launches.push(Math.round(performance.now()-start));
    if(pass===1){
      for(let cycle=0;cycle<3;cycle++)for(const name of ['电影','剧集','全部视频']){
        await page.evaluate(label=>{const result={start:0,done:0};window.__baseline=result;const observer=new MutationObserver(()=>{if(result.start&&document.querySelector('.library-heading h2')?.textContent===label&&document.querySelector('section.library')?.getAttribute('aria-busy')==='false'){result.done=performance.now()-result.start;observer.disconnect();}});observer.observe(document.body,{subtree:true,childList:true,attributes:true});const start=event=>{const button=event.target.closest?.('.primary-nav button');if(button?.textContent.trim()===label){result.start=performance.now();document.removeEventListener('click',start,true);}};document.addEventListener('click',start,true);},name);
        const t=performance.now();await page.getByRole('button',{name,exact:true}).click({noWaitAfter:true});await expect(page.locator('.library-heading h2')).toHaveText(name);await expect(page.locator('section.library')).toHaveAttribute('aria-busy','false');
        await expect.poll(()=>page.evaluate(()=>window.__baseline.done)).toBeGreaterThan(0);latencies.push(Math.round(performance.now()-t));rendererCommits.push(await page.evaluate(()=>Math.round(window.__baseline.done)));
      }
      if(artwork){
        await expect.poll(()=>page.evaluate(()=>document.visibilityState)).toBe('visible');
        const first=page.locator('.card').first().locator('img.thumbnail');
        await expect(first).toHaveClass(/thumbnail-ready/);
        const src=await first.getAttribute('src');let firstRequests=0;
        const count=request=>{if(request.url().endsWith(src))firstRequests++;};page.on('request',count);
        const memory=await desktop.evaluate(({app})=>app.getAppMetrics().reduce((sum,p)=>sum+p.memory.privateBytes,0));
        for(let pass=0;pass<6;pass++){
          const timing=await page.evaluate(async()=>{
            const scroller=document.getElementById('app-scroll-area'),deltas=[];let previous=performance.now();
            for(let n=0;n<30;n++){scroller.scrollTop=(n%2?0:scroller.scrollHeight);await new Promise(requestAnimationFrame);const now=performance.now();deltas.push(now-previous);previous=now;}
            return {maxFrameGapMs:Math.max(...deltas),over50ms:deltas.filter(value=>value>50).length};
          });
          await expect(first).toHaveClass(/thumbnail-ready/);await expect(first).toHaveAttribute('src',src);
          scrollSamples.push({...timing,privateKiB:await desktop.evaluate(({app})=>app.getAppMetrics().reduce((sum,p)=>sum+p.memory.privateBytes,0))});
        }
        assert.equal(firstRequests,0,'Scrolling must not reload admitted first cover');
        page.off('request',count);assert.ok(scrollSamples.at(-1).privateKiB-memory<256*1024,'Bounded page scroll memory growth');
        await page.locator('.card').last().scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.getElementById('app-scroll-area').scrollTop)>0);
        await page.getByRole('button',{name:'电影',exact:true}).evaluate(button=>button.click());
        await expect.poll(()=>page.evaluate(()=>document.getElementById('app-scroll-area').scrollTop)).toBe(0);
        await page.getByRole('button',{name:'全部视频',exact:true}).click();
      }
      const t=performance.now();await page.getByRole('button',{name:'显示目录树',exact:true}).click();await expect(page.getByRole('tree')).toBeVisible();latencies.push(Math.round(performance.now()-t));
      await page.getByRole('button',{name:'搜索视频',exact:true}).click();const search=page.getByRole('textbox',{name:'搜索视频',exact:true});const ts=performance.now();await search.fill('mp4');await expect(page.locator('.library-query-placeholder')).toHaveCount(0);await expect(page).toHaveURL(/q=mp4/);latencies.push(Math.round(performance.now()-ts));
      const health=await page.evaluate(async()=>(await(await fetch('/api/health')).json()));assert.equal(health.data_dir,profile);
      const scan=await page.evaluate(async()=>(await(await fetch('/api/scan')).json()));assert.ok(!scan||!['discovering','running'].includes(scan.state));
    }
    await desktop.close();desktop=null;
  }
  const sorted=[...latencies].sort((a,b)=>a-b),report={mode:'real-E-downloads-metadata-clone; Electron development; no source mutations; bounded real artwork when requested; no OS cache eviction; wall time includes automation overhead, renderer time is trusted-click to matching query DOM commit, not video frame timing',...counts,first_launch_ms:launches[0],same_profile_relaunch_ms:launches[1],artwork,scrollSamples,interaction_ms:latencies,renderer_commit_ms:rendererCommits,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],startup_stages:readFileSync(path.join(profile,'desktop.log'),'utf-8').split(/\r?\n/).filter(line=>line.includes('startup-stage'))};
  writeFileSync(path.join(workspace,'baseline.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,covers:counts.covers.length,startup_stages:report.startup_stages.length}));console.log('Owned baseline report:',path.join(workspace,'baseline.json'));
}finally{if(desktop)await desktop.close();}
