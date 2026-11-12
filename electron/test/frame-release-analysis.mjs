// Analyze bounded probe data; timestamps are not physical scanout evidence.
export function analyzeFrameReleases(report){
 const main=report.delivery,renderer=report.rendererDelivery;
 const unique=events=>[...new Map(events.filter(e=>typeof e.textureId==='string').map(e=>[`${e.kind}:${e.at}:${e.textureId}`,e])).values()];
 const mainEvents=unique([...Object.values(main.worst),...main.captures.flatMap(c=>[...c.before,...c.after])]);
 const rendererEvents=unique([...Object.values(renderer.worst),...renderer.tail,...renderer.delays.flatMap(d=>[d,...d.entries])]);
 const index=events=>Map.groupBy(events,e=>e.textureId),a=index(mainEvents),b=index(rendererEvents);
 const crossClock=Number.isFinite(main.timeOrigin)&&Number.isFinite(renderer.timeOrigin);
 return {scope:'Observed callback stages, not a causal or exact cross-process clock certification; missing phases remain null',clockScope:crossClock?'performance.timeOrigin comparison, approximate epoch alignment':'Missing time origin; cross-process handoff unavailable',rows:[...new Set([...a.keys(),...b.keys()])].flatMap(id=>{
  const m=a.get(id)??[],r=b.get(id)??[],rs=r.find(e=>e.kind==='renderer-native-release-done'),ms=m.find(e=>e.kind==='main-native-release-start'),md=m.find(e=>e.kind==='main-native-release-done'),gpu=r.find(e=>e.kind==='renderer-gpu-done');
  if(!rs&&!md)return [];
  const handoff=crossClock&&rs&&ms?(ms.at+main.timeOrigin)-(rs.at+rs.ms+renderer.timeOrigin):null;
  return [{textureId:id,rendererGpuMs:gpu?.ms??null,rendererReleaseMs:rs?.ms??null,mainReleaseMs:md?.ms??null,approximateHandoffMs:handoff,clockOrderUncertain:handoff!==null&&handoff<0}];
 }).sort((x,y)=>Math.max(y.rendererReleaseMs??0,y.mainReleaseMs??0,y.approximateHandoffMs??0)-Math.max(x.rendererReleaseMs??0,x.mainReleaseMs??0,x.approximateHandoffMs??0)).slice(0,12)};
}
