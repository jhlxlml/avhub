// Synthetic bundler graph tests, plus separate actual build-output inspection.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import path from 'node:path';
import {frontendNotices} from '../../scripts/frontend-notices.mjs';
const root=path.resolve(import.meta.dirname,'../..');
function fixture({license=true,version='1.0.0',name='demo'}={}){
 mkdirSync(path.join(root,'build'),{recursive:true});const folder=mkdtempSync(path.join(root,'build/frontend-notices-test-')),pkg=path.join(folder,'node_modules',name);mkdirSync(pkg,{recursive:true});
 writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name,version,license:'MIT'}));
 if(license)writeFileSync(path.join(pkg,'LICENSE'),'Exact synthetic notice bytes\n');
 writeFileSync(path.join(folder,'package-lock.json'),JSON.stringify({packages:{['node_modules/'+name]:{version:'1.0.0'}}}));
 const module=path.join(pkg,'index.js');return {folder,module};
}
function collect(f,modules=[f.module]){const assets=[];frontendNotices(f.folder).generateBundle.call({emitFile:item=>assets.push(item)},{},{'app.js':{type:'chunk',fileName:'app.js',moduleIds:modules}});return assets;}
test('scoped runtime licenses retain exact bytes and omit private module paths',()=>{
 const f=fixture({name:'@scope/demo'}),assets=collect(f,[f.module,f.module]);
 assert.equal(assets.length,2);assert.equal(Buffer.from(assets[0].source).toString(),'Exact synthetic notice bytes\n');
 const summary=JSON.parse(assets[1].source);assert.equal(summary.packages[0].name,'@scope/demo');assert.deepEqual(summary.packages[0].chunks,['app.js']);
 assert.ok(!assets[1].source.includes(f.folder));
});
test('missing notice and mismatched locked version reject the build',()=>{
 assert.throws(()=>collect(fixture({license:false})),/Missing.*license/);
 assert.throws(()=>collect(fixture({version:'2.0.0'})),/differs from package lock/);
});
test('unrepresented installed packages are not mistaken for shipped runtime',()=>{
 const f=fixture(),unused=path.join(f.folder,'node_modules/unused');mkdirSync(unused);writeFileSync(path.join(unused,'package.json'),'{}');
 const summary=JSON.parse(collect(f).at(-1).source);assert.equal(summary.packages.length,1);
});
test('actual frontend build includes dynamic HLS, React and icon dependency notices',()=>{
 const folder=path.join(root,'app/static'),summary=JSON.parse(readFileSync(path.join(folder,'third-party/frontend-notices.json'),'utf8'));
 for(const name of ['hls.js','react','react-dom','lucide-react','@radix-ui/react-slot'])assert.ok(summary.packages.some(p=>p.name===name));
 for(const pkg of summary.packages)for(const item of pkg.notices)assert.ok(existsSync(path.join(folder,item.path)));
});
