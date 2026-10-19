// Renderer-only visual/interaction harness. Desktop acceptance is separate.
import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});

test('quiet library chrome preserves mounted cards, query, controls and readable theme colors',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  const first=page.locator('.card').first();await first.evaluate(e=>(e as HTMLElement).dataset.polishIdentity='same');
  const url=page.url(),title=await first.locator('.video-title').textContent();
  await expect(page.getByRole('group',{name:'浏览与筛选',exact:true})).toBeVisible();
  await expect(page.getByRole('group',{name:'媒体整理',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'全部视频',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'显示目录树',exact:true})).toHaveAttribute('aria-pressed','false');
  const mediaRequests:string[]=[];
  page.on('request',r=>{if(/\/api\/media(?:\?|$)|\/playback/.test(r.url()))mediaRequests.push(r.url());});
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:theme==='light'?'切换至浅色模式':'切换至深色模式',exact:true}).click();
    await expect(first).toHaveAttribute('data-polish-identity','same');expect(page.url()).toBe(url);
    expect(await first.locator('.video-title').textContent()).toBe(title);
    const contrast=await page.evaluate(()=>{
      const root=getComputedStyle(document.documentElement);
      const luminance=(hex:string)=>{const values=hex.trim().slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
      return ['--ui-text','--ui-secondary','--ui-muted','--ui-accent'].map(key=>{
        const fg=luminance(root.getPropertyValue(key)),bg=luminance(root.getPropertyValue('--ui-bg'));return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
      });
    });
    expect(contrast.every(ratio=>ratio>=4.5)).toBe(true);
    await expect(page.locator('main>header')).toHaveCSS('backdrop-filter','none');
    await expect(page.locator('.cover').first()).toHaveCSS('aspect-ratio','16 / 9');
  }
  expect(mediaRequests).toEqual([]);
  await page.getByRole('button',{name:'批量整理',exact:true}).click();
  await expect(page.getByRole('button',{name:'批量整理',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'选中本页',exact:true}).click();
  await expect(page.getByLabel('批量选择')).toContainText('已选 48');
});

test('grouped toolbar fits desktop and compact layouts with keyboard-visible actions',async({page})=>{
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  for(const width of [1440,1200,1024,800,600,390]){
    await page.setViewportSize({width,height:850});
    await expect.poll(()=>page.locator('.toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const filter=page.getByRole('button',{name:'更多筛选',exact:true});await filter.focus();await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS('outline-style','solid');
    await page.getByRole('button',{name:'回收记录',exact:true}).focus();
    await expect(page.getByRole('button',{name:'回收记录',exact:true})).toBeFocused();
  }
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'视频格式',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'视频格式',exact:true}).selectOption('mp4');
  await expect(page.getByRole('region',{name:'当前筛选条件'})).toContainText('MP4');
});
