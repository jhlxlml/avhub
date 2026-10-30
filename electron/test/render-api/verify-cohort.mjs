// Read-only audit of owned reports and actual package bytes. Never enables M3.
import path from 'node:path';import {readFileSync,writeFileSync,lstatSync} from 'node:fs';import assert from 'node:assert/strict';
import {sourceFingerprint} from './framecode-fixtures.mjs';import attest from './runtime-attestation.cjs';import cohort from './cohort-evidence.cjs';
const root=path.resolve(import.meta.dirname,'../../..'),base=path.join(root,'build/libmpv-render-spike'),input=process.argv[2];assert.ok(input,'Pass an owned cohort JSON file');
const owned=file=>{const result=path.resolve(file);assert.ok(result.startsWith(base+path.sep),'Report outside owned M2 cache');for(let p=result;p!==base;p=path.dirname(p))assert.equal(lstatSync(p).isSymbolicLink(),false,'Redirected report path');return result;};
const request=JSON.parse(readFileSync(owned(input),'utf8')),fingerprint=await sourceFingerprint(),dll=JSON.parse(readFileSync(path.join(root,'ci/libmpv-d3d11-candidate.json'),'utf8')).dllSha256,entries={},verifiedPackages=new Map();
for(const role of cohort.roles){
 const id=request[role];if(!id){entries[role]=null;continue;}assert.match(id,/^(evidence|startup-fault)-[A-Za-z0-9]+$/);
 const report=JSON.parse(readFileSync(owned(path.join(base,id,'acceptance.json')),'utf8'));
 if(!report.artifact){entries[role]={report};continue;}
 const exe=owned(report.artifact.executable),manifest=owned(path.join(path.dirname(path.dirname(exe)),'runtime-attestation.json'));
 const key=exe+'|'+report.artifact.manifestSha256;let verification=verifiedPackages.get(key);
 if(!verification){const data=JSON.parse(readFileSync(manifest,'utf8'));assert.equal(attest.fileHash(manifest),report.artifact.manifestSha256,'Runtime manifest changed');verification={...attest.verifyAttestation(path.dirname(exe),data,fingerprint),manifestSha256:report.artifact.manifestSha256};verifiedPackages.set(key,verification);}
 const resources=path.join(path.dirname(exe),'resources/spike'),sample=JSON.parse(readFileSync(owned(path.join(resources,'sample.json')),'utf8')),options=JSON.parse(readFileSync(owned(path.join(resources,'source-options.json')),'utf8')),library=JSON.parse(readFileSync(owned(path.join(resources,'ci/libmpv-render-candidate.json')),'utf8'));
 const mediaSha256=attest.fileHash(owned(path.join(resources,'Direct.mp4')));
 entries[role]={report,verification,binding:{backend:options.backend,dllSha256:library.dllSha256,mediaSha256,metadataSha256:sample.sha256,codec:sample.codec_name,pixelFormat:sample.pix_fmt,width:sample.width,height:sample.height,durationSec:Number(sample.duration),primaries:sample.color_primaries,transfer:sample.color_transfer,matrix:sample.color_space,floatingPoint:options.floatingPoint}};
}
const result=cohort.assessCohort({sourceFingerprint:fingerprint,dllSha256:dll,entries});writeFileSync(owned(input)+'.result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.softwareCohortPassed)process.exitCode=1;
