export const formatLabel = (extension: string) => extension.replace(/^\./, '').toUpperCase() || '未知格式';
export const resolutionLabel = (width?: number, height?: number) => width && height ? `${width}×${height}` : '分辨率未知';
export const episodeLabel = ({ season, episode }: { season?: number; episode?: number }) => `${season === 0 ? '特别篇' : season != null ? `第 ${season} 季` : '季未设置'} · ${episode != null ? `第 ${episode} 集` : '集未设置'}`;

export function fileSizeLabel(bytes?:number|null):string|null {
  if(typeof bytes!=='number'||!Number.isFinite(bytes)||bytes<=0)return null;
  const units=['B','KB','MB','GB','TB'];let value=bytes,index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return `${index===0?Math.round(value):value.toFixed(value>=100?0:1)} ${units[index]}`;
}
