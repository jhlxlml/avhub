// Renderer harness only; desktop startup/exit is accepted in real Electron.
import {test,expect} from '@playwright/test';

test('optional settings code is deferred and a pending dialog can be dismissed',async({page,request})=>{
 await request.post('/test/reset');
 const loaded:string[]=[];page.on('request',r=>loaded.push(r.url()));
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/assets/Settings-*.js',async route=>{await gate;await route.continue();});
 try{
  await page.goto('/');const entry=page.getByRole('button',{name:'媒体库设置',exact:true});await expect(entry).toBeVisible();
  expect(loaded.some(url=>/\/assets\/Settings-.*\.js/.test(url))).toBe(false);
  await entry.click();await expect(page.getByText('正在打开设置…',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  release();await entry.click();
  await expect(page.getByRole('tab',{name:'播放偏好',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(loaded.some(url=>/\/assets\/Settings-.*\.js/.test(url))).toBe(true);
 }finally{release();}
});

test('optional module failure leaves the library usable and explains restart recovery',async({page,request})=>{
 await request.post('/test/reset');
 await page.route('**/assets/Settings-*.js',route=>route.fulfill({status:503,contentType:'text/javascript',body:'// owned load failure'}));
 await page.goto('/');const entry=page.getByRole('button',{name:'媒体库设置',exact:true});await entry.click();
 await expect(page.getByRole('alert')).toContainText('设置界面加载失败');
 await expect(page.getByRole('dialog')).toContainText('完全退出并重新打开 AVHub');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'电影',exact:true}).click();
 await expect(page.getByRole('button',{name:'电影',exact:true})).toHaveAttribute('aria-pressed','true');
 await entry.click();await expect(page.getByRole('alert')).toContainText('设置界面加载失败');
});
