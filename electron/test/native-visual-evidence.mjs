// Requires an interactive Windows compositor. This is NOT a decoder screenshot.
// Capture the display containing the native host, accounting for negative display
// origins and thumbnail scale. Inspect only the center (no colorful UI buttons).
export async function nativeVisualEvidence(desktop,output,target='native') {
  const result=await desktop.evaluate(async({desktopCapturer,BaseWindow,BrowserWindow,screen},target)=>{
    try{
      const host=target==='main'?BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('nativePlayer=')):BaseWindow.getAllWindows().find(w=>w.getTitle()==='AVHub · 原生播放');
      if(!host)return {status:'unavailable',reason:'host missing'};
      const bounds=host.getBounds(),display=screen.getDisplayMatching(bounds);
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
      const source=sources.find(s=>s.display_id===String(display.id))||(sources.length===1&&screen.getAllDisplays().length===1?sources[0]:undefined);
      if(!source||source.thumbnail.isEmpty())return {status:'unavailable',reason:'display capture unavailable',displayId:String(display.id),sources:sources.map(s=>({id:s.display_id,empty:s.thumbnail.isEmpty()}))};
      const size=source.thumbnail.getSize(),sx=size.width/display.bounds.width,sy=size.height/display.bounds.height;
      const x=Math.max(0,Math.round((bounds.x-display.bounds.x)*sx)),y=Math.max(0,Math.round((bounds.y-display.bounds.y)*sy));
      const width=Math.min(size.width-x,Math.round(bounds.width*sx)),height=Math.min(size.height-y,Math.round(bounds.height*sy));
      if(width<100||height<100)return {status:'unavailable',reason:'host outside captured display'};
      const crop=source.thumbnail.crop({x,y,width,height});
      const center=crop.crop({x:Math.floor(width*.2),y:Math.floor(height*.2),width:Math.floor(width*.6),height:Math.floor(height*.5)}).toBitmap();
      let red=0,blue=0;
      for(let i=0;i<center.length;i+=4){if(center[i+2]-center[i]>60)red++;if(center[i]-center[i+2]>60)blue++;}
      const pixels=center.length/4;
      return {status:red/pixels>.03&&blue/pixels>.03?'pattern-visible':'pattern-not-visible',redFraction:red/pixels,blueFraction:blue/pixels,displayScale:display.scaleFactor,bounds,png:crop.toPNG().toString('base64')};
    }catch(error){return {status:'unavailable',reason:String(error.message)};}
  },target);
  if(result.png){const {writeFileSync}=await import('node:fs');writeFileSync(output,Buffer.from(result.png,'base64'));delete result.png;}
  return result;
}
