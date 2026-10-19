export type HelpPlaybackMode='chromium'|'embedded'|'independent';
type Group={title:string;items:[string,string[]][]};
export const helpPlaybackModes:{value:HelpPlaybackMode;label:string}[]=[
  {value:'chromium',label:'现有播放器'},
  {value:'embedded',label:'MPV · 应用内嵌'},
  {value:'independent',label:'MPV · 独立窗口'},
];
export function playbackHelp(mode:HelpPlaybackMode){
  const independent=mode==='independent',native=mode!=='chromium';
  const groups:Group[]=[
    {title:'播放与跳转',items:[['播放 / 暂停',['空格','K']],['后退 / 前进 5 秒',['←','→']],['后退 / 前进 10 秒',['J','L']],['音量减 / 加 5%',['↓','↑']],['静音 / 取消静音',['M']],
      ...(independent?[['上一条 / 下一条视频',['PageUp','PageDown']] as [string,string[]]]:[['下一条视频（按当前队列）',['N']] as [string,string[]]])]},
    {title:'画面与截图',items:[['视频全屏 / 退出全屏',['F']],
      ...(!independent?[['进入 / 退出纯净播放',['W']] as [string,string[]]]:[]),
      [independent?'退出视频全屏':'退出视频全屏或纯净播放',['Esc']],
      ...(!native?[['画中画 / 退出画中画',['P']] as [string,string[]]]:[]),
      ['画面旋转 90°',['R']],['保存当前解码画面的截图',['C']],
      ...(independent?[['关闭本次播放并保存进度',['Q']] as [string,string[]]]:[])]},
  ];
  return {
    groups,
    scope:independent?'快捷键作用于 MPV 独立播放窗口；回到媒体库窗口后，不把页面按键转发给后台播放器。':'以下操作仅在播放页生效；输入文字、设置对话框、菜单中不会抢占快捷键。',
    windowGuide:independent?'独立窗口由 MPV 创建。按 F 或双击画面切换窗口全屏，Esc 只退出全屏；Q 关闭本次播放并保存进度，不退出 AVHub。窗口顶部可拖动，右上角可手动置顶、最小化、最大化或关闭。':'按 W 进入纯净播放，窗口按视频比例适配并自动置顶；退出时取消置顶并恢复窗口。按 F 切换视频全屏，Esc 先退出视频全屏，再退出纯净播放。',
    capability:independent?'独立窗口滚轮调整音量，不提供按指针缩放、拖动画面、W 纯净播放或 P 画中画；需要这些操作时请查看对应播放模式的能力。':native?'MPV 内嵌支持纯净播放、按指针缩放和拖动画面，暂不支持画中画；需要画中画时可明确切回现有播放器。':'现有播放器支持纯净播放、画面缩放、拖动画面和画中画；画中画仍取决于当前 Electron 的可用能力。',
    mouse:independent?[
      ['调整音量','播放器内滚轮（每格 2%）'],['播放 / 暂停','右键画面'],['视频全屏 / 退出全屏','双击画面'],
    ]:[
      ['以鼠标位置为中心缩放画面','播放器内滚轮'],['调整音量','Shift + 滚轮'],['移动放大的画面','按住左键拖动'],['视频全屏 / 退出全屏','双击画面'],['恢复默认缩放与画面位置','点击画面还原图标'],
    ],
    footer:independent?'Esc 只退出 MPV 全屏，不退出或关闭 AVHub。截图只保留 C 键；方向键是按秒跳转，不是逐帧选图。':'Esc 在视频全屏时先退出视频全屏，再按一次可退出纯净播放。截图只保留 C 键；方向键是按秒跳转，不是逐帧选图。Tab 聚焦按钮后，空格执行该按钮；鼠标点击播放控件后，空格仍控制播放与暂停。',
  };
}
