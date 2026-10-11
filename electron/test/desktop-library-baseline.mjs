// Read-only real-index baseline, NOT packaging and NOT an OS cold-cache test.
// The original DB is opened read-only; all changes occur in a NEW owned profile.
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ownedTemporaryWorkspace} from './owned-temp-workspace.mjs';
const root=path.resolve(import.meta.dirname,'../..');const source=process.argv[2];
assert.ok(source&&path.isAbsolute(source),'Provide an explicitly authorized read-only library DB.');
const workspace=ownedTemporaryWorkspace('avhub-library-baseline-'),profile=path.join(workspace,'profile');mkdirSync(profile);
const cloned=spawnSync(process.env.AVHUB_PYTHON||'python',['-c',
  'import os,sqlite3,json; from pathlib import Path; src=sqlite3.connect(Path(os.environ["AVHUB_BASE_SOURCE"]).as_uri()+"?mode=ro",uri=True); dst=sqlite3.connect(os.environ["AVHUB_BASE_TARGET"]);src.backup(dst);src.close(); prefix="E:"+chr(92)+"downloads"+chr(92);dst.execute("DELETE FROM media WHERE lower(substr(path,1,?))<>lower(?)",(len(prefix),prefix));dst.execute("DELETE FROM roots WHERE id NOT IN (SELECT DISTINCT root_id FROM media)"); tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")}; [dst.execute("DELETE FROM "+t) for t in ("thumbnail_jobs","file_operations","recycle_actions","source_changes","media_subtitle_links","scan_checkpoint","root_file_permissions") if t in tables];dst.execute("UPDATE media SET thumbnail=NULL,custom_cover=NULL");dst.execute("INSERT OR REPLACE INTO thumbnail_control(id,paused) VALUES(1,1)");dst.execute("DELETE FROM playlist_items WHERE media_id NOT IN (SELECT id FROM media)");dst.commit();print(json.dumps({"videos":dst.execute("SELECT COUNT(*) FROM media").fetchone()[0],"roots":dst.execute("SELECT COUNT(*) FROM roots").fetchone()[0]}));dst.close()'],
  {cwd:root,env:{...process.env,PYTHONIOENCODING:'utf-8',AVHUB_BASE_SOURCE:source,AVHUB_BASE_TARGET:path.join(profile,'library.db')},encoding:'utf-8',windowsHide:true,timeout:30000});
assert.equal(cloned.status,0,cloned.stderr);const counts=JSON.parse(cloned.stdout);assert.ok(counts.videos>1000);
let desktop;const launches=[],latencies=[],rendererCommits=[];
try{
  for(let pass=0;pass<2;pass++){
    const start=performance.now();desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:workspace,env:{...process.env,AVHUB_DATA_DIR:profile,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
    const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();await expect(page.locator('.card').first()).toBeVisible();launches.push(Math.round(performance.now()-start));
    if(pass===1){
      for(let cycle=0;cycle<3;cycle++)for(const name of ['电影','剧集','全部视频']){
        await page.evaluate(label=>{const result={start:0,done:0};window.__baseline=result;const observer=new MutationObserver(()=>{if(result.start&&document.querySelector('.library-heading h2')?.textContent===label&&document.querySelector('section.library')?.getAttribute('aria-busy')==='false'){result.done=performance.now()-result.start;observer.disconnect();}});observer.observe(document.body,{subtree:true,childList:true,attributes:true});const start=event=>{const button=event.target.closest?.('.primary-nav button');if(button?.textContent.trim()===label){result.start=performance.now();document.removeEventListener('click',start,true);}};document.addEventListener('click',start,true);},name);
        const t=performance.now();await page.getByRole('button',{name,exact:true}).click({noWaitAfter:true});await expect(page.locator('.library-heading h2')).toHaveText(name);await expect(page.locator('section.library')).toHaveAttribute('aria-busy','false');
        await expect.poll(()=>page.evaluate(()=>window.__baseline.done)).toBeGreaterThan(0);latencies.push(Math.round(performance.now()-t));rendererCommits.push(await page.evaluate(()=>Math.round(window.__baseline.done)));
      }
      const t=performance.now();await page.getByRole('button',{name:'显示目录树',exact:true}).click();await expect(page.getByRole('tree')).toBeVisible();latencies.push(Math.round(performance.now()-t));
      await page.getByRole('button',{name:'搜索视频',exact:true}).click();const search=page.getByRole('textbox',{name:'搜索视频',exact:true});const ts=performance.now();await search.fill('mp4');await expect(page.locator('.library-query-placeholder')).toHaveCount(0);await expect(page).toHaveURL(/q=mp4/);latencies.push(Math.round(performance.now()-ts));
      const health=await page.evaluate(async()=>(await(await fetch('/api/health')).json()));assert.equal(health.data_dir,profile);
      const scan=await page.evaluate(async()=>(await(await fetch('/api/scan')).json()));assert.ok(!scan||!['discovering','running'].includes(scan.state));
    }
    await desktop.close();desktop=null;
  }
  const sorted=[...latencies].sort((a,b)=>a-b),report={mode:'real-E-downloads-metadata-clone; Electron development; no source mutations; no thumbnails or OS cache eviction; wall time includes automation overhead, renderer time is trusted-click to matching query DOM commit, not video frame timing',...counts,first_launch_ms:launches[0],same_profile_relaunch_ms:launches[1],interaction_ms:latencies,renderer_commit_ms:rendererCommits,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],startup_stages:readFileSync(path.join(profile,'desktop.log'),'utf-8').split(/\r?\n/).filter(line=>line.includes('startup-stage'))};
  writeFileSync(path.join(workspace,'baseline.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,startup_stages:report.startup_stages.length}));console.log('Owned baseline report:',path.join(workspace,'baseline.json'));
}finally{if(desktop)await desktop.close();}
