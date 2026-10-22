// Renderer harness for state presentation; real desktop workflows run separately.
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');});
for(const theme of ['dark','light']) {
  test(`${theme}: initial playlist loading never claims an empty library; errors retry by keyboard`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let failed=true;
    await page.route('**/api/playlists',async route=>{if(route.request().method()!=='GET')return route.continue();if(failed){await gate;await route.fulfill({status:503,json:{detail:'测试：片单暂时不可读取'}});}else await route.fulfill({json:[]});});
    await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'播放列表',exact:true});
    await expect(panel.getByRole('status')).toContainText('正在加载列表');
    await expect(panel.getByText('创建或选择一个列表',{exact:true})).toHaveCount(0);
    await expect(panel.getByText('还没有播放列表，上方输入名称即可创建',{exact:true})).toHaveCount(0);
    release();await expect(panel.getByRole('alert')).toContainText('片单暂时不可读取');
    await expect(panel.getByRole('status')).toHaveCount(0);await expect(panel.locator('.is-empty')).toHaveCount(0);
    await page.setViewportSize({width:390,height:760});expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    const errorBox=await panel.getByRole('alert').boundingBox(),panelBox=await panel.boundingBox();
    expect(errorBox!.y).toBeLessThan(panelBox!.y+panelBox!.height/2);
    await page.screenshot({path:`build/feedback-playlist-error-${theme}.png`});
    failed=false;await panel.getByRole('button',{name:'刷新列表',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(panel.getByRole('alert')).toHaveCount(0);await expect(panel.getByText('创建或选择一个列表',{exact:true})).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);
  });
  test(`${theme}: failed detail loading does not masquerade as an empty playlist`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});
    const list=await(await request.post('/api/playlists',{data:{name:'状态验收片单'}})).json();let fail=true;
    await page.route(`**/api/playlists/${list.id}?**`,route=>fail?route.fulfill({status:503,json:{detail:'测试：片单详情读取失败'}}):route.continue());
    await page.goto('/');await page.getByRole('button',{name:'播放列表',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'播放列表',exact:true});await expect(panel.getByRole('alert')).toContainText('片单详情读取失败');
    await expect(panel.locator('.is-empty')).toHaveCount(0);await expect(panel.getByRole('status')).toHaveCount(0);
    fail=false;await panel.getByRole('button',{name:'刷新列表',exact:true}).click();
    await expect(panel.getByText('播放列表暂无视频',{exact:true})).toBeVisible();await expect(panel.getByRole('alert')).toHaveCount(0);
  });
  test(`${theme}: series errors share a bounded retry state and recover`,async({page,request})=>{
    await request.patch('/api/preferences',{data:{values:{appearance:{theme,coverSize:'standard'}}}});await request.post('/test/series-fixture');
    let fail=true;await page.route('**/api/series?**',route=>fail?route.fulfill({status:503,json:{detail:'测试：剧集不可读取'}}):route.continue());
    await page.goto('/?view=series&grouped=true');await expect(page.getByRole('alert')).toContainText('剧集不可读取');
    await expect(page.getByRole('alert')).toHaveCSS('border-top-width','0px');
    fail=false;await page.getByRole('button',{name:'重试剧集库',exact:true}).click();await expect(page.locator('.series-groups .card')).toHaveCount(48);await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
