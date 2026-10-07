import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {installExportHarness} from './native-export-harness';
test.beforeEach(async({request,page})=>{await request.post('/test/reset');await installExportHarness(page);});

test('complete backup restores custom cover and records after replacing the current library',async({page,request})=>{
  await request.post('/test/thumbnail-fixture');
  const image=await(await request.get('/thumbs/1')).body();
  // Use the real editor upload route, not a mocked backup payload.
  await page.goto('/?video=1');await page.getByText('编辑媒体信息',{exact:true}).click();
  await page.getByLabel('导入封面图片',{exact:true}).setInputFiles({name:'cover.jpg',mimeType:'image/jpeg',buffer:image});
  await expect(page.getByRole('button',{name:'恢复视频截图',exact:true})).toBeVisible();
  const before=await(await request.get('/api/media/1')).json();expect(before.custom_cover).toBeTruthy();
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await page.getByLabel('备份包含缩略图',{exact:true}).check();
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'保存完整备份',exact:true}).click();
  const downloaded=await waiting;expect(downloaded.suggestedFilename()).toBe('avhub-library.zip');
  const payload=readFileSync((await downloaded.path())!);expect(payload.subarray(0,2).toString()).toBe('PK');
  await request.post('/test/reset');
  await page.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'library.zip',mimeType:'application/zip',buffer:payload});
  await page.getByRole('button',{name:'校验并预览备份',exact:true}).click();
  await expect(page.getByRole('region',{name:'备份恢复预览'})).toContainText('当前');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复所选备份',exact:true}).click();
  await expect(page.getByRole('button',{name:'媒体库设置',exact:true})).toBeVisible();
  await expect.poll(async()=>Boolean((await(await request.get('/api/media/1')).json()).custom_cover)).toBe(true);
  const restored=await(await request.get('/api/media/1')).json();expect(restored.custom_cover).not.toBe(before.custom_cover);
  expect((await request.get('/thumbs/1')).ok()).toBe(true);
});

test('corrupt complete backup shows a useful error and keeps settings open',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'媒体库设置',exact:true}).click();
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  await page.getByLabel('选择备份文件',{exact:true}).setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from('PKnot a valid archive')});
  await page.getByRole('button',{name:'校验并预览备份',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('完整备份损坏');await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'校验并预览备份',exact:true})).toBeEnabled();
});

test('complete backup controls and diagnostic evidence fit a narrow settings dialog',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'运行诊断',exact:true}).click();await page.locator('.runtime-diagnostics summary').click();
  await expect(page.locator('.diagnostic-fields')).toContainText('异常现场');
  expect(await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();await page.locator('.backup-tools').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/full-backup-mobile.png'});
});
