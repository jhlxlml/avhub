import type {EngineKind,EnginePreference} from './types';
import type {SessionFailureKind} from './PlaybackSessionCoordinator';

export type EngineSelectionDecision=Readonly<{selected:EngineKind|null;kind:EngineKind|null;reason:string;reasonCode:string;eligible:readonly EngineKind[];recoveryClass:'none'|'manual'|'known-initialization'|'known-incompatible'}>;

/** Candidate selection, NOT decoder/HDR/physical-display certification. The
 * default remains HTML5 (persisted playerEngine=chromium). Main still owns
 * runtime integrity, file authorization and native output validation. */
export function selectEngine(options:{preference:EnginePreference;nativeEnabled?:boolean;registered?:readonly EngineKind[];
 /** sdr-trial is a deprecated internal alias, never a colour whitelist. */
 nativeScope?:'local-native-experiment'|'sdr-trial';sourceKind?:'local'|'remote';authorized?:boolean;
 nativeFailure?:SessionFailureKind;experimentalAuto?:boolean;sourceColor?:'sdr'|'hdr-unverified'|'unknown'}):EngineSelectionDecision{
 const registered=new Set(options.registered??['html5']),authorized=options.authorized!==false;
 const html5=authorized&&registered.has('html5');
 const native=authorized&&registered.has('mpv')&&options.nativeEnabled===true&&['local-native-experiment','sdr-trial'].includes(options.nativeScope??'')&&options.sourceKind==='local'&&!options.nativeFailure;
 const unsafeNative=options.preference==='mpv'&&options.nativeFailure!==undefined&&!['runtime-missing','initialization','unsupported'].includes(options.nativeFailure);
 const eligible=(['html5','mpv'] as const).filter(kind=>kind==='html5'?html5:native);
 const selected=!authorized||unsafeNative?null:options.preference==='mpv'&&native?'mpv':html5?'html5':null;
 const reasonCode=!authorized?'authorization-required':unsafeNative?'native-manual-recovery':!selected?(options.preference==='auto'&&native?'auto-default-unavailable':'no-eligible-engine'):options.preference==='auto'?(options.experimentalAuto?'auto-evidence-pending':'auto-disabled'):selected==='mpv'?'explicit-native':options.preference==='mpv'?'native-ineligible':'existing-default';
 const reasons={
  'authorization-required':'媒体授权已失效，请恢复授权后重试',
  'native-manual-recovery':'原生播放存在安全或资源错误，请先处理错误或手动选择其他原画路径',
  'no-eligible-engine':'当前没有已注册且可尝试的播放路径',
  'auto-disabled':'auto 未启用，沿用现有播放器',
  'auto-evidence-pending':'auto 仍为试验接口，尚无已放行的实测策略，沿用现有播放器',
  'auto-default-unavailable':'默认路径不可用，auto 不会自行改用原生候选；可手动选择 MPV',
  'explicit-native':'用户显式选择本地原生候选；运行库、媒体和输出仍由桌面主进程核验，HDR 实体显示效果不在此认证',
  'native-ineligible':'未满足本地原生试验或运行库条件，保留现有原画播放路径',
  'existing-default':'保留现有播放器，不更改用户默认引擎',
 };
 const recoveryClass=!selected?'manual':options.preference!=='mpv'?'none':options.nativeFailure==='unsupported'?'known-incompatible':options.nativeFailure==='runtime-missing'||options.nativeFailure==='initialization'?'known-initialization':'none';
 return Object.freeze({selected,kind:selected,reason:reasons[reasonCode],reasonCode,eligible:Object.freeze(eligible),recoveryClass});
}
