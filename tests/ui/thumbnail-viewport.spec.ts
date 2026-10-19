// Shared renderer harness; real artwork and memory acceptance is Electron-only.
import {test,expect} from '@playwright/test';
import {observeThumbnail} from '../../frontend/src/thumbnailVisibility';
test('shared observer releases every target and disconnects after final unmount',()=>{
 const previous=globalThis.IntersectionObserver;let created=0,disconnected=0,deliver:(entries:any[])=>void=()=>{};const tracked=new Set<Element>();
 globalThis.IntersectionObserver=class {constructor(callback:any){created++;deliver=callback;}observe(node:Element){tracked.add(node);}unobserve(node:Element){tracked.delete(node);}disconnect(){disconnected++;tracked.clear();}} as any;
 const cleanups:(()=>void)[]=[];let notifications=0;
 try{for(let i=0;i<96;i++)cleanups.push(observeThumbnail({} as Element,()=>notifications++));expect(created).toBe(1);expect(tracked.size).toBe(96);const node=[...tracked][0];deliver([{target:node,isIntersecting:true}]);expect(notifications).toBe(1);for(const close of cleanups)close();expect(tracked.size).toBe(0);expect(disconnected).toBe(1);deliver([{target:node,isIntersecting:true}]);expect(notifications).toBe(1);}
 finally{for(const close of cleanups)close();globalThis.IntersectionObserver=previous;}
});
test('96 covers load near the viewport once and retain decoded page images while scrolling',async({page,request})=>{
 await request.post('/test/reset');await request.post('/test/thumbnail-fixture');const jpeg=await(await request.get('/thumbs/1?v=1')).body();
 let firstRequests=0;
 await page.route('**/thumbs/**',route=>{if(new URL(route.request().url()).pathname==='/thumbs/1')firstRequests++;return route.fulfill({body:jpeg,contentType:'image/jpeg'});});
 await page.route('**/api/media?**',route=>route.fulfill({json:{items:Array.from({length:96},(_,i)=>({id:i+1,name:`sample-${i}`,title:`测试封面 ${i+1}`,path:`D:\\owned\\${i}.mp4`,kind:'movie',ext:'.mp4',duration:120,width:320,height:180,thumbnail_url:`/thumbs/${i+1}?v=1`,missing:0,favorite:0,progress:0})),total:96,page:1,pages:1,page_size:96}}));
 await page.setViewportSize({width:900,height:600});await page.goto('/?pageSize=96');await expect(page.locator('.card')).toHaveCount(96);await expect(page.locator('.card').first().locator('.thumbnail-ready')).toBeVisible();
 expect(await page.locator('.card img.thumbnail[src]').count()).toBeLessThan(30);
 const first=page.locator('.card').first().locator('img.thumbnail');
 await page.locator('.card').last().scrollIntoViewIfNeeded();await expect(page.locator('.card').last().locator('.thumbnail-ready')).toBeVisible();await expect(first).toHaveAttribute('src','/thumbs/1?v=1');
 await page.locator('.card').first().scrollIntoViewIfNeeded();await expect(first).toHaveAttribute('src','/thumbs/1?v=1');await expect(first).toHaveClass(/thumbnail-ready/);
 expect(firstRequests).toBe(1);
 await page.getByRole('button',{name:'搜索视频',exact:true}).click();await page.getByRole('textbox',{name:'搜索视频',exact:true}).fill('测试');await expect(page.locator('.card')).toHaveCount(96);
 expect(await page.locator('.card img.thumbnail[src]').count()).toBeLessThanOrEqual(96);
});
