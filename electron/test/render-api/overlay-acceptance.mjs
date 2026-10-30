// Actual Electron compositor pixels + native state, not a mock subtitle layer.
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {expect} from '@playwright/test';
export async function overlayAcceptance({desktop,controls,evidence,floatingPoint,label='windowed'}){
 const native=(action,value)=>controls.evaluate(({action,value})=>window.renderSpike.command(action,value),{action,value});
 await assert.rejects(()=>native('subtitle-probe','C:\\untrusted.ass'),/Unsupported command/);
 await assert.rejects(()=>native('osd-probe',{text:'untrusted'}),/Unsupported command/);
 async function settle(){if(floatingPoint)await desktop.evaluate(()=>globalThis.__renderSpike.probeFrame());else await desktop.evaluate(()=>globalThis.__renderSpike.command('redraw'));}
 async function capture(name,baseline=false){
  const result=await desktop.evaluate(async(_,{name,baseline})=>{
   const image=await globalThis.__renderSpike.main.webContents.capturePage(),s=image.getSize();
   // Ignore the React title and controls. This is screenshot evidence only,
   // never a CPU source upload or a high-bit-depth/color-luminance proof.
   const crop=image.crop({x:Math.floor(s.width*.1),y:Math.floor(s.height*.2),width:Math.floor(s.width*.8),height:Math.floor(s.height*.55)}),pixels=crop.toBitmap();
   if(baseline)globalThis.__overlayBaseline=Buffer.from(pixels);
   const old=globalThis.__overlayBaseline;if(!old||old.length!==pixels.length)throw new Error('Overlay baseline dimensions changed');
   let changed=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(Math.abs(old[i]-pixels[i]),Math.abs(old[i+1]-pixels[i+1]),Math.abs(old[i+2]-pixels[i+2]))>24)changed++;
   return {name,changedPixels:changed,pixels:pixels.length/4,png:image.toPNG().toString('base64')};
  },{name,baseline});
  writeFileSync(path.join(evidence,'overlay-'+label+'-'+name+'.png'),Buffer.from(result.png,'base64'));delete result.png;return result;
 }
 await native('pause',true);await native('subtitle-probe',false);await native('osd-probe',false);await settle();
 const baseline=await capture('baseline',true),samples=[];
 await native('subtitle-probe',true);
 await expect.poll(async()=>(await native('snapshot')).subtitleText).toContain('AVHub ASS');
 await expect.poll(async()=>{await settle();return (await capture('ass')).changedPixels;}).toBeGreaterThan(80);
 samples.push(await capture('ass'));
 await native('subtitle-probe',false);await settle();
 await expect.poll(async()=>{await settle();return (await capture('ass-hidden')).changedPixels;}).toBeLessThan(20);
 samples.push(await capture('ass-hidden'));
 await native('osd-probe',true);
 await expect.poll(async()=>{await settle();return (await capture('osd')).changedPixels;}).toBeGreaterThan(80);
 samples.push(await capture('osd'));
 await native('subtitle-probe',true);
 await expect.poll(async()=>{await settle();return (await capture('combined')).changedPixels;}).toBeGreaterThan(samples[2].changedPixels+80);
 samples.push(await capture('combined'));
 await controls.getByRole('button',{name:'设置',exact:true}).click();await expect(controls.getByRole('menu')).toBeVisible();
 await controls.screenshot({path:path.join(evidence,'overlay-'+label+'-react-menu.png')});
 await controls.keyboard.press('Escape');await expect(controls.getByRole('menu')).toHaveCount(0);
 assert.equal((await native('snapshot')).pause,'yes','Menu Escape changed native playback');
 await native('subtitle-probe',false);await native('osd-probe',false);await settle();
 await expect.poll(async()=>{await settle();return (await capture('all-hidden')).changedPixels;}).toBeLessThan(20);
 samples.push(await capture('all-hidden'));
 const slider=controls.getByRole('slider',{name:'跳播'});await slider.focus();
 await controls.keyboard.press('Space');await expect.poll(async()=>(await native('snapshot')).pause).toBe('no');
 await controls.keyboard.press('Space');await expect.poll(async()=>(await native('snapshot')).pause).toBe('yes');
 await controls.keyboard.down('Space');await controls.keyboard.down('Space');await controls.keyboard.up('Space');
 await expect.poll(async()=>(await native('snapshot')).pause).toBe('no');
 await controls.keyboard.press('Space');await expect.poll(async()=>(await native('snapshot')).pause).toBe('yes');
 // A focused React button must not also synthesize a click after Space keyup.
 const play=controls.getByRole('button',{name:'播放',exact:true});await play.focus();
 await controls.keyboard.press('Space');await expect.poll(async()=>(await native('snapshot')).pause).toBe('no');
 await controls.keyboard.press('Space');await expect.poll(async()=>(await native('snapshot')).pause).toBe('yes');
 await controls.getByRole('button',{name:'设置',exact:true}).click();
 await controls.keyboard.press('Space');assert.equal((await native('snapshot')).pause,'yes','Open menu leaked Space to playback');
 await controls.keyboard.press('Escape');await expect(controls.getByRole('menu')).toHaveCount(0);
 return {scope:'Fixed ASS glyph/rotation/outline/vector plus native OSD presence in SDR Electron compositor; not all subtitle formats or physical color certification',label,baseline,samples,rangeFocusSpacePassed:true,buttonFocusSpacePassed:true,repeatKeyIgnored:true,menuEscapeAndSpaceIsolationPassed:true,invalidProbePayloadsRejected:true};
}
