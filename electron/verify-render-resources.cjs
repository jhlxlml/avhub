// Shared packaging boundary for local acceptance and ordinary desktop inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
module.exports=async({root,backend,runtime,layout,expectedManifestSha})=>{
 execFileSync('python',['scripts/folder-portable.py','--verify-backend-notices','--backend-directory',backend],{cwd:root,windowsHide:true,stdio:'pipe'});
 const {verifyRenderRuntime}=require('./dist/renderHostClient.js');await verifyRenderRuntime(runtime);
 if(expectedManifestSha&&crypto.createHash('sha256').update(fs.readFileSync(runtime.manifest)).digest('hex')!==expectedManifestSha)throw new Error('Native runtime manifest changed');
 const folder=path.dirname(runtime.manifest);
 for(const file of layout.files){
  const target=path.resolve(folder,file.path),relative=path.relative(folder,target);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid native runtime member');
  const info=fs.lstatSync(target);if(!info.isFile()||info.isSymbolicLink()||fs.realpathSync(target).toLowerCase()!==target.toLowerCase()||info.size!==file.size)throw new Error('Runtime layout changed: '+file.path);
  const hash=crypto.createHash('sha256'),fd=fs.openSync(target,'r'),chunk=Buffer.allocUnsafe(1024**2);
  try{let count;while((count=fs.readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,count));}finally{fs.closeSync(fd);}
  if(hash.digest('hex')!==file.sha256)throw new Error('Runtime checksum mismatch: '+file.path);
 }
};
