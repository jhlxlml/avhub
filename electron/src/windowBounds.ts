import type {Rectangle} from 'electron';

// Electron bounds/work areas are DIP, already adjusted for the display scale.
// Keep the title bar and playback controls reachable on high-DPI/small screens.
export function initialLibraryWindow(work:Rectangle){
 const marginX=Math.min(16,Math.max(0,Math.floor((work.width-1)/2)));
 const marginY=Math.min(16,Math.max(0,Math.floor((work.height-1)/2)));
 const width=Math.max(1,Math.min(1440,Math.floor(work.width-2*marginX)));
 const height=Math.max(1,Math.min(900,Math.floor(work.height-2*marginY)));
 return{bounds:{x:Math.round(work.x+(work.width-width)/2),y:Math.round(work.y+(work.height-height)/2),width,height},
  minimum:[Math.min(760,width),Math.min(560,height)] as [number,number]};
}
