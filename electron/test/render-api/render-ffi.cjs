// Only loaded in the trusted prototype main process. Never exposed by preload.
const {readFileSync,lstatSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
exports.loadVerifiedFfi=function(folder,manifestPath){
 const manifest=JSON.parse(readFileSync(manifestPath));
 if(process.platform!=='win32'||process.arch!=='x64'||manifest.version!=='3.3.4'||manifest.platform!=='win32-x64')throw new Error('Unverified FFI platform');
 for(const item of manifest.files){
  const target=path.resolve(folder,item.name);if(!target.startsWith(path.resolve(folder)+path.sep))throw new Error('Unsafe FFI path');
  for(let cursor=target;cursor!==path.resolve(folder);cursor=path.dirname(cursor))if(lstatSync(cursor).isSymbolicLink())throw new Error('Redirected FFI path');
  const bytes=readFileSync(target);if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('FFI integrity: '+item.name);
 }
 // Load the exact checked addon, not Koffi's optional JS search/fallback paths.
 const native=require(path.join(folder,'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'));
 if(native.version!==manifest.version)throw new Error('FFI native version mismatch');
 return native;
};
