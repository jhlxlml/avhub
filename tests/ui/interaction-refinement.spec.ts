// Renderer-only interaction harness; native acceptance uses electron/test/mouse-seek.mjs.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
async function settings(page:any){await page.getByRole('button',{name:'媒体库设置',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();}
test('unsaved mouse and directory drafts survive cancellation and tab changes',async({page})=>{
  await page.goto('/');await settings(page);const input=page.getByLabel('鼠标侧键跳播时长');await input.fill('17');
  await page.getByRole('tab',{name:'帮助',exact:true}).click();await page.getByRole('tab',{name:'播放偏好',exact:true}).click();await expect(input).toHaveValue('17');
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('鼠标侧键时长');await dialog.dismiss();});await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(input).toHaveValue('17');
  await page.getByRole('button',{name:'保存鼠标快捷键',exact:true}).click();await expect(page.getByText('鼠标侧键时长已保存',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'媒体目录',exact:true}).click();await page.getByLabel('目录路径',{exact:true}).fill('D:\\NotYetAdded');
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('待添加目录');await dialog.dismiss();});await page.keyboard.press('Escape');await expect(page.getByLabel('目录路径',{exact:true})).toHaveValue('D:\\NotYetAdded');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'关闭设置',exact:true}).click();await settings(page);await expect(input).toHaveValue('17');
});
test('playlist mode and autoplay remain session-local across next video and reload',async({page,request})=>{
  await request.patch('/api/preferences',{data:{values:{queueMode:'repeat-one',autoNext:false,queueScope:'directory'}}});
  const list=await(await request.post('/api/playlists',{data:{name:'独立播放测试',media_ids:[2,3]}})).json();
  await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();await page.getByRole('button',{name:'随机播放列表',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('playlist='+list.id));await expect(page.getByRole('button',{name:'展开待播队列'})).toBeVisible();await page.getByRole('button',{name:'展开待播队列'}).click();
  await expect(page.getByLabel('播放模式',{exact:true})).toHaveValue('random');await expect(page.getByLabel('自动连播',{exact:true})).not.toBeChecked();
  await page.getByLabel('播放模式',{exact:true}).selectOption('sequential');await page.getByLabel('自动连播',{exact:true}).check();
  await expect.poll(async()=>(await(await request.get('/api/preferences')).json()).values).toMatchObject({queueMode:'repeat-one',autoNext:false,queueScope:'directory'});
  await page.reload();await expect(page.getByLabel('播放模式',{exact:true})).toHaveValue('sequential');await expect(page.getByLabel('自动连播',{exact:true})).toBeChecked();
  const restart=page.getByRole('button',{name:'从头开始',exact:true});if(await restart.isVisible())await restart.click();
  const before=page.url();await page.locator('.queue-content ol button:not(:disabled)').first().click();await expect.poll(()=>page.url()).not.toBe(before);
  await expect(page.getByLabel('播放模式',{exact:true})).toHaveValue('sequential');await expect(page.getByLabel('自动连播',{exact:true})).toBeChecked();
  await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await settings(page);await expect(page.getByLabel('连播模式',{exact:true})).toHaveValue('repeat-one');await expect(page.getByLabel('视频连播',{exact:true})).not.toBeChecked();
});
for(const errors of [0,1])test(`scan completion automatically collapses only without errors (${errors})`,async({page})=>{
  await page.clock.install();await page.route('**/api/scan',route=>route.fulfill({json:{id:'finished-audit',state:'completed',root_id:null,total:1,processed:1,updated:1,current:'',started_at:1,finished_at:2,error_count:errors,errors:errors?[{path:'offline.mp4',message:'不可访问'}]:[]}}));
  await page.goto('/');await expect(page.getByRole('region',{name:'扫描任务'})).toBeVisible();await page.clock.fastForward(5100);
  if(errors)await expect(page.getByRole('region',{name:'扫描任务'})).toBeVisible();else await expect(page.getByRole('region',{name:'扫描任务'})).toHaveCount(0);
});
