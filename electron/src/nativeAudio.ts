/** Device identities/descriptions stay inside MPV. Export availability only. */
export type AudioOutputStatus={state:'unknown'|'unavailable'|'available';availableCount:number|null};

export function audioOutputStatus(value:unknown):AudioOutputStatus{
  if(!Array.isArray(value))return {state:'unknown',availableCount:null};
  const devices=new Set<string>();
  for(const item of value){
    if(!item||typeof item!=='object'||typeof item.name!=='string')return {state:'unknown',availableCount:null};
    const name=item.name.trim();
    if(!name)return {state:'unknown',availableCount:null};
    if(name!=='auto')devices.add(name);
  }
  return {state:devices.size?'available':'unavailable',availableCount:devices.size};
}

export function audioOutputFailure(status:AudioOutputStatus){
  const prefix='音频输出设备初始化失败',quality='未自动静音或转换音频';
  if(status.state==='unavailable')return `${prefix}：当前会话未检测到可用的声音输出设备，请连接或启用扬声器/耳机后重试；${quality}`;
  if(status.state==='available')return `${prefix}：已检测到声音输出设备，请重试原生播放；仍失败时请检查 Windows 默认输出设备或设备占用；${quality}`;
  return `${prefix}，请检查 Windows 声音输出设备后重试；${quality}`;
}
