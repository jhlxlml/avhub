// Offline compatibility check for the narrowly scoped downloader proxy override.
// Uses only loopback servers; never downloads Electron or builds a release.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import http from 'node:http';
const require=createRequire(import.meta.url);
const builderRequire=createRequire(require.resolve('app-builder-lib/package.json'));
const downloaderRequire=createRequire(builderRequire.resolve('@electron/get/package.json'));
const agent=downloaderRequire('global-agent');
assert.equal(downloaderRequire('global-agent/package.json').version,'4.1.3');
assert.equal(typeof agent.bootstrap,'function');
const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url),'utf8'));
assert.equal(manifest.overrides['@electron/get']['global-agent'],'4.1.3');
assert.equal(manifest.devDependencies.vite,'8.3.5');
assert.equal(lock.packages['node_modules/vite'].version,'8.3.5');
assert.equal(Object.keys(lock.packages).some(key=>key.endsWith('/sprintf-js')),false);
let proxyHits=0,directHits=0;
const originalAgent=http.globalAgent;
const proxy=http.createServer((request,response)=>{proxyHits++;assert.match(request.url,/^http:\/\/avhub-proxy-test\.invalid\//);response.setHeader('Connection','close');response.end('proxy-ok');});
const direct=http.createServer((_request,response)=>{directHits++;response.setHeader('Connection','close');response.end('direct-ok');});
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const read=url=>new Promise((resolve,reject)=>{const request=http.get(url,{headers:{Connection:'close'}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve(body));});request.on('error',reject);request.setTimeout(3000,()=>request.destroy(new Error('Local proxy check timed out')));});
try{
  await listen(proxy);await listen(direct);
  process.env.GLOBAL_AGENT_HTTP_PROXY=`http://127.0.0.1:${proxy.address().port}`;
  process.env.GLOBAL_AGENT_HTTPS_PROXY=process.env.GLOBAL_AGENT_HTTP_PROXY;
  process.env.GLOBAL_AGENT_NO_PROXY='127.0.0.1';
  builderRequire('@electron/get').initializeProxy();
  assert.equal(await read('http://avhub-proxy-test.invalid/owned-fixture'),'proxy-ok');
  assert.equal(await read(`http://127.0.0.1:${direct.address().port}/owned-fixture`),'direct-ok');
  assert.equal(proxyHits,1);assert.equal(directHits,1);
  console.log('Build dependency policy passed: pinned Vite, no sprintf-js, downloader bootstrap proxy and NO_PROXY on loopback.');
}finally{
  originalAgent.destroy();
  await Promise.all([proxy,direct].map(server=>new Promise(resolve=>server.close(resolve))));
}
