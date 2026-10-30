// Pure color/contrast contracts; real desktop layout is accepted separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTheme,themeColors,themePresets,defaultTheme,colorContrast,validHex} from '../src/themePalette.ts';

test('legacy and malformed theme input retains safe defaults without accepting CSS',()=>{
 assert.deepEqual(normalizeTheme({theme:'light',coverSize:'large'}),{...defaultTheme,theme:'light'});
 for(const accent of ['red','var(--ui-text)','#fff','#12345678','url(x)',';color:red',null,12])assert.equal(normalizeTheme({accent}).accent,defaultTheme.accent);
 assert.deepEqual(normalizeTheme({theme:'auto',palette:'missing',background:'missing',emphasis:1}),defaultTheme);
 assert.equal(normalizeTheme({accent:'#AABBCC',palette:'custom',theme:'system'}).accent,'#aabbcc');
});

test('preset and extreme custom colors remain readable across modes, surfaces and emphasis',()=>{
 const inputs=[...themePresets.map(p=>({palette:p.id})),...['#ffffff','#000000','#ffff00','#00ff00','#00ffff','#ff0000','#ff00ff','#0000ff','#777777'].map(accent=>({palette:'custom',accent}))];
 for(const input of inputs)for(const background of ['neutral','cool','warm'])for(const emphasis of ['soft','standard'])for(const mode of ['light','dark']){
  const settings=normalizeTheme({...input,background,emphasis}),before=JSON.stringify(settings),colors=themeColors(settings,mode),tag=JSON.stringify({input,background,emphasis,mode});
  for(const value of Object.values(colors))assert.equal(validHex(value),true,tag);
  for(const fg of ['text','secondary','muted','accent'])for(const bg of ['bg','surface','raised','field','hover'])assert.ok(colorContrast(colors['--ui-'+fg],colors['--ui-'+bg])>=4.5,tag+' '+fg+'/'+bg);
  assert.ok(colorContrast(colors['--ui-on-accent'],colors['--ui-accent'])>=4.5,tag+' primary');
  assert.ok(colorContrast(colors['--ui-selection-fg'],colors['--ui-selection-bg'])>=4.5,tag+' selection');
  assert.ok(colorContrast(colors['--ui-overlay-accent'],'#101722')>=4.5,tag+' overlay');
  assert.equal(JSON.stringify(settings),before,'Generating display colors never rewrites the chosen color');
 }
});

test('default neutral surfaces remain compatible and emphasis changes selection strength',()=>{
 assert.equal(themeColors(defaultTheme,'light')['--ui-bg'],'#f6f6f8');
 assert.equal(themeColors(defaultTheme,'light')['--ui-accent'],'#4f46c7');
 assert.equal(themeColors(defaultTheme,'dark')['--ui-bg'],'#111214');
 for(const mode of ['light','dark'])assert.notEqual(themeColors(defaultTheme,mode)['--ui-selection-bg'],themeColors({...defaultTheme,emphasis:'standard'},mode)['--ui-selection-bg']);
});
