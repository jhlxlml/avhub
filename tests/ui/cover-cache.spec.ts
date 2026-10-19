// Renderer HTTP cache harness; real Electron transfer/memory acceptance uses
// desktop-cover-stress.mjs. No route interception (it disables browser cache).
import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.post('/test/reset');await request.post('/test/thumbnail-fixture');});

test('current artwork is reusable in browser HTTP cache without changing pixels',async({page,request})=>{
  const item=await(await request.get('/api/media/1')).json();
  await page.goto('/?q=001');await expect(page.locator('img.thumbnail-ready').first()).toBeVisible();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');let hits=0;
  cdp.on('Network.requestServedFromCache',()=>hits++);
  cdp.on('Network.responseReceived',event=>{if(event.response.fromDiskCache)hits++;});
  const reads=await page.evaluate(async url=>{
    const values=[];
    for(const cache of ['reload','default','default'] as RequestCache[]){const r=await fetch(url,{cache});values.push({status:r.status,policy:r.headers.get('cache-control'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))});}
    return values;
  },item.thumbnail_url);
  expect(reads.map(value=>value.policy)).toEqual(Array(3).fill('private, max-age=300'));
  expect(reads[0].bytes).toEqual(reads[1].bytes);expect(reads[1].bytes).toEqual(reads[2].bytes);
  await expect.poll(()=>hits).toBeGreaterThan(0);
});

test('missing art is not cached and regenerated versions bypass stale addresses',async({page,request})=>{
  await page.goto('/?q=002');
  const read=(url:string)=>page.evaluate(async url=>{const r=await fetch(url);return {status:r.status,policy:r.headers.get('cache-control'),length:(await r.arrayBuffer()).byteLength};},url);
  expect(await read('/thumbs/2?v=1')).toMatchObject({status:404,policy:'no-store'});
  await request.post('/test/repair-thumbnail-fixture');
  const item=await(await request.get('/api/media/2')).json();expect(item.thumbnail_url).toBe('/thumbs/2?v=2.0');
  expect(await read(item.thumbnail_url)).toMatchObject({status:200,policy:'private, max-age=300'});
  expect(await read('/thumbs/2?v=1')).toMatchObject({status:200,policy:'no-cache'});
  expect(await read('/thumbs/2?v=NaN')).toMatchObject({status:200,policy:'no-cache'});
});

test('artwork conditional revalidation returns 304 without image transfer and missing art remains 404',async({request})=>{
  const first=await request.get('/thumbs/1?v=1');expect(first.status()).toBe(200);
  const tag=first.headers()['etag'];expect(tag).toMatch(/^"[a-f0-9]{64}"$/);
  const validated=await request.get('/thumbs/1?v=1',{headers:{'If-None-Match':tag,'Cache-Control':'no-cache'}});
  expect(validated.status()).toBe(304);expect((await validated.body()).byteLength).toBe(0);
  expect(validated.headers()['cache-control']).toBe('private, max-age=300');
  const missing=await request.get('/thumbs/999999?v=1',{headers:{'If-None-Match':'*'}});
  expect(missing.status()).toBe(404);expect(missing.headers()['cache-control']).toBe('no-store');
});
