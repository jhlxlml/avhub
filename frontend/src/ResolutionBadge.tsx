import {resolutionLabel,resolutionTier,resolutionDisplayLabel} from './mediaLabels';

export function ResolutionBadge({width,height}:{width?:number;height?:number}) {
  const tier=resolutionTier(width,height);
  if(!tier)return null;
  const exact=resolutionLabel(width,height);
  return <span className={`resolution-badge${tier==='4K'||tier==='8K'?' resolution-badge-ultra':''}`}
    title={`源视频 ${exact} · 按短边分级`} aria-label={`源视频分辨率 ${resolutionDisplayLabel(tier)}，${exact}`}>{resolutionDisplayLabel(tier)}</span>;
}
