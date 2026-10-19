import {useState,type KeyboardEvent} from 'react';
import {AboutPanel} from './AppTools';
import {Icon,type IconName} from './Icon';
import {preference} from './preferences';
import {playbackHelp,helpPlaybackModes,type HelpPlaybackMode} from './playbackHelp';
import './help.css';

const sections:{id:string;label:string;icon:IconName}[]=[{id:'guide',label:'使用指南',icon:'library'},{id:'shortcuts',label:'快捷操作',icon:'keyboard'},{id:'about',label:'关于',icon:'info'}];
export function HelpPanel({changeBusy,busy}:{changeBusy:(busy:boolean)=>void;busy:boolean}) {
  const [section,setSection]=useState('guide');
  const [mode,setMode]=useState<HelpPlaybackMode>(()=>preference<string>('playerEngine','chromium')==='mpv'?(preference<string>('mpvWindowMode','embedded')==='independent'?'independent':'embedded'):'chromium');
  const help=playbackHelp(mode);
  function navigate(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    if(busy||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+(event.key==='ArrowRight'?1:-1)+sections.length)%sections.length;
    setSection(sections[next].id);document.getElementById('help-tab-'+sections[next].id)?.focus();
  }
  return <section className="help-center" aria-label="帮助中心">
    <div className="help-heading"><Icon name="help" size={20}/><div><h3>帮助与使用</h3><p>常用操作、快捷键与应用信息，随时查阅。</p></div></div>
    <div className="help-tabs" role="tablist" aria-label="帮助内容">{sections.map((item,index)=><button key={item.id} id={'help-tab-'+item.id} type="button" role="tab" aria-selected={section===item.id} tabIndex={section===item.id?0:-1} aria-controls={'help-panel-'+item.id} disabled={busy}
      onClick={()=>setSection(item.id)} onKeyDown={event=>navigate(event,index)}><Icon name={item.icon} size={15}/>{item.label}</button>)}</div>
    {section!=='about'&&<div className="help-mode-picker"><label>查看播放模式 <select aria-label="帮助播放模式" value={mode} disabled={busy} onChange={event=>setMode(event.target.value as HelpPlaybackMode)}>{helpPlaybackModes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><p className="help-hint">仅切换帮助说明，不修改播放引擎或偏好。</p></div>}
    <div role="tabpanel" id={'help-panel-'+section} aria-labelledby={'help-tab-'+section}>
      {section==='guide'&&<div className="help-guide">
        <section className="help-card"><h4><Icon name="folder" size={16}/>开始观看</h4><ol><li>在“媒体目录”中浏览本地文件夹或输入路径，添加一个或多个目录。</li><li>点击“刷新媒体库”扫描。首次扫描需要时间，封面在后台逐步生成。</li><li>使用顶部分类、目录树、搜索和分辨率筛选查找视频，点击封面开始播放。</li></ol></section>
        <section className="help-card"><h4><Icon name="purePlayback" size={16}/>播放窗口与鼠标</h4><p>{help.windowGuide}</p><p>停在控制栏上时控件保持显示；移出后隐藏控件，但移动中的鼠标仍可见。在画面上停止移动约 400 毫秒后隐藏光标，移回控制区可唤回控件。</p><p>{help.capability}</p></section>
        <section className="help-card"><h4><Icon name="external" size={16}/>下载与升级</h4><p>在“关于”点击“检查更新”后，可查看已提供的便携格式。文件夹 ZIP 需完整解压后运行 AVHub.exe，避免每次启动重新解包；单文件 EXE 启动时先解包。</p><p>升级前关闭旧版，保留 AVHub-data 和 avhub-data-location.json；不要只复制文件夹版中的 EXE。通过 SHA256SUMS.txt 校验下载文件。检查更新不会自动下载或安装。</p></section>
        <section className="help-card"><h4><Icon name="camera" size={16}/>截图与画面</h4><p>播放页按 C 或点击相机图标，直接保存 PNG，不弹保存窗口。默认目录可在“播放偏好 → 视频截图”中设置并保存。</p><p>截图来自当前解码画面，不包含控制栏、外挂文字字幕或显示层缩放与旋转；片源烧录的字幕会保留。目前没有上一帧 / 下一帧功能。</p><p>HDR / 10-bit 截图不保证保留原始色彩与位深；显示缩放不会增加片源本身的细节。</p></section>
        <section className="help-card"><h4><Icon name="shield" size={16}/>原画与数据安全</h4><p>优先播放原文件；需要换容器时优先无损重新封装。确实不兼容时，只有经过确认才允许有损兼容转换。MPV 的 HDR / 高于 8-bit 原生显示尚未验收，暂不开放入口，不会自动降位深或映射为 SDR。</p><p>视频默认只读。文件重命名和系统回收需在媒体目录中逐目录授权；文件正在读取或处理时不能整理。重命名同步视频标题，保留收藏、进度和片单，不提供重命名撤销。外挂字幕不自动改名。回收记录可恢复文件至原目录，也可在 Windows 回收站还原后核对恢复或刷新媒体库。</p><p>清除已恢复或失效的回收历史不删除现有文件。“永久删除”则会删除选定的系统回收站项目，需要目录授权并再次确认，删除后无法通过回收站恢复；不会清空整个系统回收站，也不会直接永久删除源目录文件。</p><p>应用不保管被回收的视频，不提供剪辑。更换数据目录下次启动迁移，旧目录保留；升级前建议备份，导入媒体库备份后需重新授权文件整理。</p></section>
        <details className="help-faq"><summary>常见问题</summary><dl><dt>为什么找不到视频？</dt><dd>检查目录是否在线、筛选条件是否清空，并刷新媒体库。盘符或位置改变时使用“重新定位”。</dd><dt>为什么快捷键没有响应？</dt><dd>关闭设置或菜单，退出输入框后再试。明确用 Tab 聚焦滑块时，方向键优先调整该滑块。</dd><dt>是否自动检查更新？</dt><dd>不会。切到“关于”，点击版本号旁的“检查更新”才联网，不自动下载或安装。</dd></dl></details>
      </div>}
      {section==='shortcuts'&&<><p className="help-hint">{help.scope}</p><div className="help-shortcut-grid">{help.groups.map(group=><section className="help-card" key={group.title}><h4>{group.title}</h4><dl className="help-shortcuts">{group.items.map(([label,keys])=><div key={label}><dt>{label}</dt><dd>{keys.map((key,index)=><span key={key}>{index>0&&<i>/</i>}<kbd>{key}</kbd></span>)}</dd></div>)}</dl></section>)}</div>
        <section className="help-card help-mouse"><h4><Icon name="mouse" size={16}/>鼠标操作</h4><dl className="help-shortcuts"><div><dt>快进 / 快退（默认 5 秒）</dt><dd>鼠标前进 / 后退侧键</dd></div>{help.mouse.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>侧键步长可在“播放偏好 → 鼠标侧键跳播”中设置为 1–120 秒，只影响鼠标侧键。驱动需将侧键设为标准前进 / 后退功能。</p><p>{help.capability}</p></section>
        <p className="help-hint">{help.footer}片单中的模式和连播开关只影响本次片单，不改全局偏好。</p></>}
      {section==='about'&&<AboutPanel changeBusy={changeBusy}/>}
    </div>
  </section>;
}
