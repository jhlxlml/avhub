import {PlaybackSessionFailure,isAutomaticRecoveryKind,type SessionFailureKind} from './PlaybackSessionCoordinator';

// Legacy admission refusal recognition only. Current MPV does not reject
// missing colour metadata. This never certifies HDR or changes source tags.
export function isNativeColorMetadataRejection(detail:string){
 return /^视频缺少(?:色域|传递函数|色彩矩阵|色彩范围)(?:、(?:色域|传递函数|色彩矩阵|色彩范围))*标记，无法验证原生色彩；不代表视频损坏或运行库缺失。请点击“切换现有播放器”尝试原文件直放；不会补写色彩、转码或降低画质$/.test(detail);
}

/** Classify once at the trusted native error boundary. Unknown decoder/host
 * exit is manual; matching a substring is never proof of initialization. */
export function classifyNativeFailure(detail:string|PlaybackSessionFailure):SessionFailureKind{
 if(detail instanceof PlaybackSessionFailure)return detail.kind;
 if(detail==='原生渲染宿主未能启动')return 'initialization';
 if(new Set(['原生嵌入运行库未通过完整性校验','原生渲染构建信息不完整','原生渲染构建清单无效','原生渲染运行库文件无效','原生渲染源码已有变化，请重新编译宿主']).has(detail))return 'integrity';
 if(detail==='视频文件不存在')return 'media-offline';
 if(detail==='源视频已变化，请刷新索引后再启动原生播放')return 'source-invalid';
 if(detail==='播放记录尚未保存，请重试关闭')return 'save';
 if(detail==='原生播放器仍未退出，保留文件占用保护')return 'cleanup';
 if(isNativeColorMetadataRejection(detail)||new Set(['当前显示模式未通过 SDR 嵌入验收，请使用现有原画路径','当前嵌入播放路径不可用：完整画面超过 D3D11 单张纹理尺寸上限。可切换其他原画播放路径；不会自动转码或降低画质']).has(detail))return 'unsupported';
 return 'unknown';
}

export function mayReturnAfterNativeOpenFailure(detail:string|PlaybackSessionFailure){const kind=classifyNativeFailure(detail);return kind==='initialization'||kind==='runtime-missing';}
export function isNativePathUnavailable(detail:string|PlaybackSessionFailure){return isAutomaticRecoveryKind(classifyNativeFailure(detail));}
