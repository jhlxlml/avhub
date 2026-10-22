import {test as base,expect} from '@playwright/test';
// Test-only bounded transport evidence. Never hides an error, extends a timeout,
// retries a write or serializes headers, query strings or media source paths.
export const test=base.extend<{transportEvidence:void}>({transportEvidence:[async({page,request},use,info)=>{
 const events:unknown[]=[];const started=Date.now();
 const record=(url:string,detail:Record<string,unknown>)=>{
   const parsed=new URL(url);if(parsed.origin!=='http://127.0.0.1:8877'||!/^\/(api|media)\//.test(parsed.pathname))return;
   if(events.length>=32)events.shift();events.push({ms:Date.now()-started,path:parsed.pathname,...detail});
 };
 page.on('requestfailed',r=>record(r.url(),{method:r.method(),failure:r.failure()?.errorText}));
 page.on('response',r=>{if(r.status()>=400)record(r.url(),{method:r.request().method(),status:r.status()});});
 await use();
 if(info.status!==info.expectedStatus){
   let health:unknown={available:false};
   try{const response=await request.get('/api/health',{timeout:1500});const data=await response.json();health={status:response.status(),build_id:data.build_id,renderer_test:data.renderer_test};}catch{}
   await info.attach('local-service-evidence',{body:JSON.stringify({events,health},null,2),contentType:'application/json'});
 }
},{auto:true}]});
export {expect};
