import {test,expect} from '@playwright/test';
test('default is added; both field and direction persist without relying on URL or browser storage',async({page,request})=>{
  await request.post('/test/reset');await page.goto('/');
  const sort=page.getByRole('combobox',{name:'排序方式',exact:true});
  await expect(sort).toHaveValue('added');await expect(page.getByRole('button',{name:'切换为升序',exact:true})).toBeVisible();
  await sort.selectOption('modified');await page.getByRole('button',{name:'切换为升序',exact:true}).click();
  await expect.poll(async()=> (await(await request.get('/api/preferences')).json()).values.librarySort).toBe('modified_asc');
  await page.evaluate(()=>localStorage.clear());await page.goto('/');
  await expect(sort).toHaveValue('modified');await expect(page.getByRole('button',{name:'切换为降序',exact:true})).toBeVisible();
  await page.goto('/?sort=name_desc');await expect(sort).toHaveValue('name');
  await expect.poll(async()=> (await(await request.get('/api/preferences')).json()).values.librarySort).toBe('name_desc');
  await page.goto('/?sort=invalid');await expect(sort).toHaveValue('name');
  await expect(page.getByRole('button',{name:'切换为升序',exact:true})).toBeVisible();
});
