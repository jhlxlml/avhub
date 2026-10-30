// Shared pure palette model for Electron and renderer surfaces.
// Never accepts CSS, URLs or media transforms.
export const themePresets=[
  {id:'violet',label:'紫色',light:'#4f46c7',dark:'#b4bdfb'},
  {id:'blue',label:'蓝色',light:'#2464be',dark:'#98bdf4'},
  {id:'teal',label:'青绿色',light:'#18766e',dark:'#7ecfc0'},
  {id:'amber',label:'暖橙',light:'#9a591c',dark:'#e7bc83'},
  {id:'graphite',label:'石墨灰',light:'#505864',dark:'#bdc2cc'},
] as const;
export type ThemeMode='dark'|'light'|'system';
export type ResolvedTheme='dark'|'light';
export type ThemeSettings={theme:ThemeMode;palette:typeof themePresets[number]['id']|'custom';accent:string;background:'neutral'|'cool'|'warm';emphasis:'soft'|'standard'};
export const defaultTheme:ThemeSettings={theme:'dark',palette:'violet',accent:'#4f46c7',background:'neutral',emphasis:'soft'};
export const validHex=(value:string)=>/^#[0-9a-f]{6}$/i.test(value);
export function normalizeTheme(value:unknown):ThemeSettings{
 const v=value&&typeof value==='object'?value as Partial<ThemeSettings>:{};
 return {theme:v.theme==='light'||v.theme==='system'?v.theme:'dark',palette:v.palette==='custom'||themePresets.some(p=>p.id===v.palette)?v.palette!:defaultTheme.palette,
  accent:typeof v.accent==='string'&&validHex(v.accent)?v.accent.toLowerCase():defaultTheme.accent,
  background:v.background==='cool'||v.background==='warm'?v.background:'neutral',emphasis:v.emphasis==='standard'?'standard':'soft'};
}
const rgb=(hex:string)=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
export function mixColor(front:string,back:string,amount:number){const a=rgb(front),b=rgb(back);return '#'+a.map((v,i)=>Math.round(v*amount+b[i]*(1-amount)).toString(16).padStart(2,'0')).join('');}
function luminance(hex:string){const [r,g,b]=rgb(hex).map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;}
export function colorContrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(color:string,backgrounds:string[],mode:ResolvedTheme){
 for(let n=0;n<=100;n++){const next=mixColor(mode==='light'?'#000000':'#ffffff',color,n/100);if(backgrounds.every(bg=>colorContrast(next,bg)>=4.6))return next;}
 return mode==='light'?'#000000':'#ffffff';
}
const neutral={light:['#f6f6f8','#ffffff','#eeeef2','#e9e9ef','#fafafa','#ffffff','#d8d9e0','#e5e6eb','#202126','#51535e','#686a76'],
 dark:['#111214','#1b1c1f','#25262a','#303136','#17181b','#17181b','#3a3c43','#2c2e34','#f4f4f5','#c4c5cd','#a2a4af']};
const cool={light:['#f3f6fa','#ffffff','#eaf0f7','#e2eaf4','#f7f9fc','#ffffff','#d3dce8','#e0e7f0','#202630','#505c6c','#657285'],
 dark:['#0f141c','#171e29','#222c3a','#2d394a','#141b25','#141b25','#344154','#273344','#f1f4f9','#c0cbda','#9eacbf']};
const warm={light:['#f8f5f0','#fffdf9','#f0ebe3','#ece5dc','#fbf8f3','#fffdf9','#e1d8cd','#eae1d7','#29241f','#60594f','#746d63'],
 dark:['#171411','#211d19','#2d2722','#39312b','#1c1815','#1c1815','#494038','#382f29','#f4f1eb','#cec7bc','#b0a699']};
const names=['bg','surface','raised','hover','field','chrome','border','divider','text','secondary','muted'];
export function themeColors(settings:ThemeSettings,mode:ResolvedTheme):Record<string,string>{
 const values=({neutral,cool,warm}[settings.background])[mode],surfaces=values.slice(0,6),tokens:Record<string,string>={};
 names.forEach((name,i)=>{tokens['--ui-'+name]=i>=8?readable(values[i],surfaces,mode):values[i];});
 const preset=themePresets.find(p=>p.id===settings.palette)??themePresets[0],raw=settings.palette==='custom'?settings.accent:preset[mode];
 let accent=readable(raw,surfaces,mode),soft='',selection='';
 const strong=settings.emphasis==='standard';
 const softAmount=mode==='light'?(strong ? .14 : .08):(strong ? .20 : .12);
 const selectionAmount=mode==='light'?(strong ? .20 : .12):(strong ? .30 : .20);
 for(let n=0;n<5;n++){
  soft=mixColor(accent,values[1],softAmount);selection=mixColor(accent,values[1],selectionAmount);
  const next=readable(accent,[...surfaces,soft,selection],mode);if(next===accent)break;accent=next;
 }
 soft=mixColor(accent,values[1],softAmount);selection=mixColor(accent,values[1],selectionAmount);
 const onAccent=colorContrast('#ffffff',accent)>=4.5?'#ffffff':colorContrast('#14213b',accent)>=4.5?'#14213b':'#000000';
 return {...tokens,'--ui-accent':accent,'--ui-accent-hover':mixColor(mode==='light'?'#000000':'#ffffff',accent,.12),'--ui-on-accent':onAccent,
  '--ui-accent-soft':soft,'--ui-selection-bg':selection,'--ui-selection-fg':readable(accent,[selection],mode),
  '--ui-accent-border':mixColor(accent,values[1],.25),'--ui-focus-ring':mixColor(accent,values[1],.2),
  '--ui-overlay-accent':readable(settings.palette==='custom'?settings.accent:preset.dark,['#101722','#303136'],'dark')};
}
