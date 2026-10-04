import type { Rectangle } from 'electron';

// All geometry is client-area DIP, not source pixels or outer window borders.
export function playbackMinimum(ratio:number, work:Rectangle): [number,number] {
  const width=ratio>=1?Math.max(480,270*ratio):270;
  const scale=Math.min(1,work.width/width,work.height/(width/ratio));
  return [Math.round(width*scale),Math.round(width/ratio*scale)];
}

export function fitPlaybackBounds(current:Rectangle, work:Rectangle, ratio:number, largest=false):Rectangle {
  const minimum=playbackMinimum(ratio,work);
  const maxHeight=Math.min(work.height,work.width/ratio);
  // Fractional-DPI Windows may round the OS minimum upwards. Leave a few DIP
  // above that boundary so measured client-area correction is not clamped.
  const minHeight=Math.max(minimum[1]+4,(minimum[0]+4)/ratio);
  const height=Math.min(maxHeight,Math.max(minHeight,largest?maxHeight:Math.sqrt(current.width*current.height/ratio)));
  const width=Math.min(work.width,Math.round(height*ratio)), roundedHeight=Math.min(work.height,Math.round(height));
  return {width,height:roundedHeight,
    x:Math.round(Math.max(work.x,Math.min(work.x+work.width-width,current.x+(current.width-width)/2))),
    y:Math.round(Math.max(work.y,Math.min(work.y+work.height-roundedHeight,current.y+(current.height-roundedHeight)/2)))};
}
