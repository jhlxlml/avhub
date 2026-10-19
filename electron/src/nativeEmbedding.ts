export type NativeViewport={x:number;y:number;width:number;height:number;clip:{x:number;y:number;width:number;height:number};visible:boolean;radius?:number};
export function nativeViewport(value:unknown):NativeViewport{
  if(!value||typeof value!=='object')throw new Error('原生播放区域无效');
  const v=value as NativeViewport;
  if(![v.x,v.y,v.width,v.height,v.clip?.x,v.clip?.y,v.clip?.width,v.clip?.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=32768)||typeof v.visible!=='boolean'||v.width<1||v.height<1||v.clip.x<0||v.clip.y<0||v.clip.width<0||v.clip.height<0||v.clip.x+v.clip.width>v.width+1||v.clip.y+v.clip.height>v.height+1)throw new Error('原生播放区域无效');
  if(v.radius!==undefined&&(typeof v.radius!=='number'||!Number.isFinite(v.radius)||v.radius<0||v.radius>128))throw new Error('原生播放圆角无效');
  return {x:v.x,y:v.y,width:v.width,height:v.height,clip:{...v.clip},visible:v.visible,...(v.radius===undefined?{}:{radius:v.radius})};
}
