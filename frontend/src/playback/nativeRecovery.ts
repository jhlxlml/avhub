// An unknown/generic source error is not a recoverable decoder initialization
// failure. Default to manual recovery; only known render-runtime failures may
// consume the Player's one-time explicit-handoff return budget.
export function mayReturnAfterNativeOpenFailure(detail:string){
 return new Set([
  '原生渲染宿主未能启动',
  '原生渲染宿主已退出',
  '原生嵌入运行库未通过完整性校验',
  '原生渲染构建信息不完整',
  '原生渲染构建清单无效',
  '原生渲染运行库文件无效',
  '原生渲染源码已有变化，请重新编译宿主',
 ]).has(detail);
}

// A bounded, explicit backend admission refusal is different from an unknown
// source error. Keep metadata unchanged and allow the existing original path.
export function isNativeColorMetadataRejection(detail:string){
 return /^视频缺少(?:色域|传递函数|色彩矩阵|色彩范围)(?:、(?:色域|传递函数|色彩矩阵|色彩范围))*标记，无法验证原生色彩；不代表视频损坏或运行库缺失。请点击“切换现有播放器”尝试原文件直放；不会补写色彩、转码或降低画质$/.test(detail);
}

// Only a known inability to use this render path may switch engines. Source
// permission, progress-save and process-cleanup failures must remain visible.
export function isNativePathUnavailable(detail:string){
 return isNativeColorMetadataRejection(detail)||mayReturnAfterNativeOpenFailure(detail)||(/^当前嵌入播放路径不可用：(完整画面超过 D3D11|当前嵌入输出为 sRGB)/.test(detail))||detail==='当前显示模式未通过 SDR 嵌入验收，请使用现有原画路径';
}
