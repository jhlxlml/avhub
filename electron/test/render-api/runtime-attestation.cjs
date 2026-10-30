// M2 build consistency only; not a code signature or a production updater.
const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const digest=/^[a-f0-9]{64}$/;
function fileHash(file){
 const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
 try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size>1024**3)throw new Error('Invalid runtime file');let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null))!==0)hash.update(buffer.subarray(0,size));const after=fs.fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Runtime changed during hashing');return hash.digest('hex');}finally{fs.closeSync(fd);}
}
function safeName(name){return typeof name==='string'&&name&&!name.startsWith('/')&&!/[\\:\x00-\x1f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');}
function mutable(name){return name==='resources/spike/electron-user-data'||/^resources\/spike\/run-logs-[A-Za-z0-9]+$/.test(name);}
function catalogue(root){
 root=path.resolve(root);if(fs.lstatSync(root).isSymbolicLink())throw new Error('Redirected runtime root');
 const files=[];let bytes=0;
 function walk(folder,relative=''){
  for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=relative?relative+'/'+item.name:item.name;if(!safeName(name))throw new Error('Unsafe runtime name');const target=path.join(folder,item.name),stat=fs.lstatSync(target);
   if(stat.isSymbolicLink())throw new Error('Redirected runtime member: '+name);
   if(stat.isDirectory()){if(!mutable(name))walk(target,name);continue;}
   if(!stat.isFile())throw new Error('Unsupported runtime member: '+name);
   bytes+=stat.size;if(bytes>3*1024**3||files.length>=5000)throw new Error('Runtime attestation capacity exceeded');
   files.push({path:name,size:stat.size,sha256:fileHash(target)});
  }
 }
 walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function createAttestation(root,sourceFingerprint){
 if(!digest.test(sourceFingerprint))throw new Error('Invalid source fingerprint');
 const files=catalogue(root);if(!files.length)throw new Error('Empty runtime');
 return {schema:1,scope:'Private M2 complete runtime consistency, not a release/signature',sourceFingerprint,preflightWarmsFiles:true,mutableDirectories:['resources/spike/electron-user-data','resources/spike/run-logs-<random>'],files};
}
function verifyAttestation(root,record,sourceFingerprint){
 if(record?.schema!==1||!digest.test(sourceFingerprint)||record.sourceFingerprint!==sourceFingerprint||!Array.isArray(record.files)||!record.files.length||record.files.length>5000)throw new Error('Stale/invalid runtime attestation');
 const names=new Set();for(const f of record.files){if(!safeName(f.path)||names.has(f.path)||!Number.isSafeInteger(f.size)||f.size<0||!digest.test(f.sha256))throw new Error('Unsafe/duplicate attestation member');names.add(f.path);}
 const actual=catalogue(root);if(JSON.stringify(actual)!==JSON.stringify(record.files))throw new Error('Packaged runtime changed: rebuild the private prototype');
 return {verified:true,sourceFingerprint,fileCount:actual.length,totalBytes:actual.reduce((n,f)=>n+f.size,0),preflightWarmsFiles:true};
}
function verifyLocation(location,sourceFingerprint,ownedBase){
 const base=path.resolve(ownedBase),executable=path.resolve(location.executable||'');
 if(!executable.startsWith(base+path.sep)||location.sourceFingerprint!==sourceFingerprint||!digest.test(location.sha256||'')||fileHash(executable)!==location.sha256)throw new Error('Stale/invalid private executable');
 const attestation=location.attestation;if(!attestation||!digest.test(attestation.sha256||''))throw new Error('Missing complete runtime attestation; rebuild the private prototype');
 const file=path.resolve(attestation.path);if(!file.startsWith(base+path.sep)||fs.statSync(file).size>5*1024**2||fileHash(file)!==attestation.sha256)throw new Error('Attestation manifest identity mismatch');
 const result=verifyAttestation(path.dirname(executable),JSON.parse(fs.readFileSync(file,'utf8')),sourceFingerprint);
 return {...result,manifestSha256:attestation.sha256,executable};
}
module.exports={fileHash,createAttestation,verifyAttestation,verifyLocation};
