import {normalizeTheme,themeColors,themePresets,validHex,type ThemeSettings} from './themePalette';
export type NativeAppearance=Pick<ThemeSettings,'palette'|'accent'|'background'|'emphasis'>;
export function nativeAppearance(value:unknown):NativeAppearance{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('原生窗口配色无效');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==4||!['palette','accent','background','emphasis'].every(k=>k in v)||typeof v.accent!=='string'||!validHex(v.accent)||
  ![...themePresets.map(p=>p.id),'custom'].includes(v.palette as string)||!['neutral','cool','warm'].includes(v.background as string)||!['soft','standard'].includes(v.emphasis as string))throw new Error('原生窗口配色无效');
 const {palette,accent,background,emphasis}=normalizeTheme(v);return {palette,accent,background,emphasis};
}
export type NativeColors={accent:string;surface:string;raised:string;hover:string;text:string;muted:string;selection:string;selectionText:string};
export function nativeThemeColors(value:unknown):NativeColors{
 const c=themeColors(normalizeTheme(value),'dark');
 return {accent:c['--ui-accent'],surface:c['--ui-surface'],raised:c['--ui-raised'],hover:c['--ui-hover'],text:c['--ui-text'],muted:c['--ui-muted'],selection:c['--ui-selection-bg'],selectionText:c['--ui-selection-fg']};
}
export function nativeColorsJson(value:NativeColors):string{
 const keys=['accent','surface','raised','hover','text','muted','selection','selectionText'];
 if(!value||Object.keys(value).length!==keys.length||keys.some(k=>typeof value[k as keyof NativeColors]!=='string'||!validHex(value[k as keyof NativeColors])))throw new Error('原生窗口颜色数据无效');
 return JSON.stringify(value);
}
