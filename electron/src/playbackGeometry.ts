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
  // Round one axis, derive the other from that rounded value. Independently
  // rounding height and height*ratio compounds error after rotations, most
  // visibly in short ultrawide windows at fractional Windows DPI.
  let roundedHeight=Math.min(Math.floor(work.height),Math.round(height));
  let width=Math.round(roundedHeight*ratio);
  if(ratio<1){width=Math.round(height*ratio);roundedHeight=Math.round(width/ratio);}
  if(width>work.width){width=Math.floor(work.width);roundedHeight=Math.round(width/ratio);}
  if(roundedHeight>work.height){roundedHeight=Math.floor(work.height);width=Math.round(roundedHeight*ratio);}
  // Extremely thin videos may have no integer-DIP pair satisfying both the
  // work-area bound and OS minimum. Preserve the feasible minimum in that case.
  if(width<minimum[0]-1||roundedHeight<minimum[1]-1){width=Math.min(work.width,Math.round(height*ratio));roundedHeight=Math.min(work.height,Math.round(height));}
  return {width,height:roundedHeight,
    x:Math.round(Math.max(work.x,Math.min(work.x+work.width-width,current.x+(current.width-width)/2))),
    y:Math.round(Math.max(work.y,Math.min(work.y+work.height-roundedHeight,current.y+(current.height-roundedHeight)/2)))};
}
