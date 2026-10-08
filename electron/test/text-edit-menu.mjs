import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');mkdirSync(path.join(root,'build'),{recursive:true});
const data=mkdtempSync(path.join(root,'build','electron-text-menu-'));let desktop;
try {
  desktop=await _electron.launch({args:[root,'--in-process-gpu','--disable-gpu','--no-sandbox'],cwd:data,
    env:{...process.env,AVHUB_DATA_DIR:data,AVHUB_HEADLESS_TEST:'1',AVHUB_SMOKE_TEST:'0'},timeout:60000});
  const page=await desktop.firstWindow();await page.getByRole('button',{name:'媒体库设置',exact:true}).waitFor();
  const canClipboard=await desktop.evaluate(async({Menu,clipboard,ClipboardItem})=>{
    globalThis.menuCaptures=[];
    // Capture popup creation, then activate the built-in role's native handler.
    // This does not pretend to click OS menu pixels.
    Menu.prototype.popup=function(options){globalThis.editMenu=this;globalThis.editWindow=options.window;globalThis.menuCaptures.push(this.items.map(i=>({role:i.role,label:i.label,enabled:i.enabled,type:i.type})));};
    try {
      // Materialize every format before changing the OS clipboard. Keeping
      // lazy readers could accidentally restore the later test payload.
      globalThis.clipboardSaved=await Promise.all((await clipboard.read()).map(async item=>{
        const values={};for(const type of item.types)values[type]=await item.getType(type);return new ClipboardItem(values);
      }));
      return true;
    }catch{return false;}
  });
  await page.getByRole('button',{name:'搜索视频',exact:true}).click();const input=page.getByRole('textbox',{name:'搜索视频',exact:true});
  await input.fill('old query');
  async function menu(field=input) {
    const count=await desktop.evaluate(()=>globalThis.menuCaptures.length);
    await field.click({button:'right'});
    await expect.poll(()=>desktop.evaluate(()=>globalThis.menuCaptures.length)).toBe(count+1);
    return desktop.evaluate(()=>globalThis.menuCaptures.at(-1));
  }
  async function activate(role) {
    await desktop.evaluate((_electron,role)=>{
      const item=globalThis.editMenu.items.find(i=>i.role===role.toLowerCase());
      if(!item?.enabled)throw new Error('Disabled/missing edit role: '+role);
      item.click({},globalThis.editWindow,globalThis.editWindow.webContents);
    },role);
  }
  const first=await menu();assert.deepEqual(first.filter(i=>i.role).map(i=>i.label),['撤销','重做','剪切','复制','粘贴','全选']);
  await activate('selectAll');
  assert.equal(await input.evaluate(el=>el.selectionEnd-el.selectionStart),'old query'.length);
  if(canClipboard) {
    await desktop.evaluate(async({clipboard})=>{globalThis.clipboardOwned='AVHub paste sample';await clipboard.writeText(globalThis.clipboardOwned);});
    await menu();await activate('paste');await expect(input).toHaveValue('AVHub paste sample');
    await expect(page).toHaveURL(/q=AVHub\+paste\+sample/);
    await menu();await activate('undo');await expect(input).toHaveValue('old query');
    await menu();await activate('redo');await expect(input).toHaveValue('AVHub paste sample');
    await menu();await activate('selectAll');await menu();await activate('copy');
    assert.equal(await desktop.evaluate(async({clipboard})=>await clipboard.readText()),'AVHub paste sample');
    await menu();await activate('cut');await expect(input).toHaveValue('');
    await input.press('Control+V');await expect(input).toHaveValue('AVHub paste sample');
  }
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const pathInput=page.getByRole('textbox',{name:'目录路径',exact:true});
  // Native text fields in dialogs use the same context menu policy.
  const target=pathInput;
  await target.fill('D:\\sample');await menu(target);
  assert.equal((await desktop.evaluate(()=>globalThis.menuCaptures.at(-1))).find(i=>i.role==='paste').label,'粘贴');
  await target.fill('');
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const count=await desktop.evaluate(()=>globalThis.menuCaptures.length);await page.locator('.brand').click({button:'right'});
  await page.waitForTimeout(100);assert.equal(await desktop.evaluate(()=>globalThis.menuCaptures.length),count);
  console.log(`Real Electron text menu passed: actual right-click popup capture, native role editing/search, select-all, dialog path field and non-text exclusion. Clipboard actions ${canClipboard?'verified':'skipped to preserve unknown clipboard formats'}. OS menu pixel selection not exercised.`);
} finally {
  if(desktop) {
    await desktop.evaluate(async({clipboard})=>{
      if(globalThis.clipboardSaved && await clipboard.readText()===globalThis.clipboardOwned) {
        if(globalThis.clipboardSaved.length)await clipboard.write(globalThis.clipboardSaved);else await clipboard.clear();
      }
    }).catch(()=>{});
    await desktop.close();
  }
}
