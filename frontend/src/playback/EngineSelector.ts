import type {EngineKind,EnginePreference} from './types';
// SDR M2 scope is explicitly approved. The trial is opt-in and local-only;
// selecting a candidate does not bypass trusted source/display validation.
export function selectEngine(options:{preference:EnginePreference;nativeEnabled?:boolean;registered?:readonly EngineKind[];nativeScope?:'sdr-trial';sourceKind?:'local'|'remote'}){
 if(options.preference==='mpv'&&options.nativeEnabled===true&&options.nativeScope==='sdr-trial'&&options.sourceKind==='local'&&options.registered?.includes('mpv'))return {kind:'mpv' as const,reason:'显式 SDR 试验；打开仍须通过源和显示校验'};
 return {kind:'html5' as const,reason:options.preference==='mpv'?'未进入原生 SDR 试验范围，保留现有播放路径':'保留现有 HTML5 播放路径'};
}
