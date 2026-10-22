// Component/decoder harness. Desktop acceptance is electron/test/library-refinement.mjs.
import {test,expect} from '@playwright/test';

test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light'])test(`${theme}: Mira primitives retain action hierarchy, descriptions and focus`,async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
  await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  await expect(page.locator('html')).toHaveClass(theme==='dark'?/dark/:/^(?!.*\bdark\b)/);
  expect(await page.locator('.primary-nav').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(32);
  expect(await page.locator('svg.ui-icon').evaluateAll(items=>items.every(el=>el.classList.contains('lucide')&&el.getAttribute('stroke-width')==='1.75'))).toBe(true);
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-slot','dialog');
  await expect(dialog).toHaveAccessibleDescription('目录默认只读，可按目录授权文件重命名和系统回收；不改视频内容。');
  const add=dialog.getByRole('button',{name:'添加目录',exact:true});
  await expect(add).toHaveAttribute('data-variant','default');await expect(add).toBeDisabled();
  const input=page.getByRole('textbox',{name:'目录路径',exact:true});await input.fill('D:\\Unsaved-Mira-Fixture');
  await expect(add).toBeEnabled();
  const colors=await add.evaluate(el=>{const s=getComputedStyle(el);return{bg:s.backgroundColor,fg:s.color,height:el.getBoundingClientRect().height};});
  expect(colors.bg).not.toBe(colors.fg);expect(colors.height).toBeGreaterThanOrEqual(32);
  // Focus-visible is intentionally keyboard-only, not every pointer focus.
  await input.focus();await page.keyboard.press('Tab');await expect(add).toBeFocused();await expect(add).toHaveCSS('outline-style','solid');
  await page.keyboard.press('Escape');const confirm=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});
  await expect(confirm).toBeVisible();
  const discard=confirm.getByRole('button',{name:'放弃修改',exact:true});
  await expect(discard).toHaveAttribute('data-variant','destructive');
  expect(await discard.evaluate(el=>getComputedStyle(el).color)).not.toBe(colors.fg);
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(input).toHaveValue('D:\\Unsaved-Mira-Fixture');
});

test('Mira has no preflight, remote UI assets or motion requirement',async({page})=>{
  const external:string[]=[];page.on('request',request=>{if(!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))external.push(request.url());});
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  const button=page.getByRole('button',{name:'浏览本地文件夹',exact:true});
  await expect(button).toHaveCSS('transition-duration','0s');
  await expect(page.locator('body')).toHaveCSS('margin','0px');
  await expect(page.locator('link[href*="fonts"],script[src^="https://"]')).toHaveCount(0);
  expect(external).toEqual([]);
});

for(const width of [320,608])test(`${width}px compact chrome retains visible covers and named icon actions`,async({page})=>{
  await page.setViewportSize({width,height:400});await page.goto('/');await expect(page.locator('.card')).toHaveCount(48);
  expect(await page.locator('main>header').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(130);
  await expect(page.locator('.card .cover').first()).toBeInViewport();
  const refresh=page.getByRole('button',{name:'刷新媒体库',exact:true});
  await expect(refresh).toBeVisible();await expect(refresh).toHaveAttribute('title','刷新媒体库');
  await page.getByRole('button',{name:'搜索视频',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'搜索视频',exact:true})).toBeVisible();
  expect(await page.locator('html').evaluate(el=>el.scrollWidth<=innerWidth+1)).toBe(true);
});
