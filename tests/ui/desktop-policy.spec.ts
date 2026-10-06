import {test,expect} from '@playwright/test';
test('unmarked browser sessions cannot launch the product UI',async({page,request})=>{
  await request.post('/test/reset');
  await page.route('**/api/health',async route=>{const body=await(await route.fetch()).json();body.renderer_test=false;await route.fulfill({json:body});});
  await page.goto('/');await expect(page.getByRole('alert')).toContainText('AVHub 仅支持桌面版');
  await expect(page.getByRole('button',{name:'媒体库设置',exact:true})).toHaveCount(0);
});
test('marked component harness can test UI, but never falls back to an HTTP OS picker',async({page,request})=>{
  await request.post('/test/reset');const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/pick'))requests.push(r.url());});
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('button',{name:'浏览本地文件夹',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('桌面组件尚未就绪');expect(requests).toHaveLength(0);
});
