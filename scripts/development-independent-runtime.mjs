import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Shared development/test selection. Actual launch still verifies every binary.
export function developmentIndependentRuntime(root,supplied){
 let candidate=supplied,approved;
 const file=path.join(root,'build/independent-mkv-runtime-acceptance.json');
 if(!candidate&&existsSync(file)){
  approved=JSON.parse(readFileSync(file,'utf8'));
  if(!approved||approved.schema!==1||approved.passed!==true||typeof approved.candidate!=='string'||!approved.candidate||typeof approved.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(approved.manifestSha256)||typeof approved.exeSha256!=='string'||!/^[a-f0-9]{64}$/.test(approved.exeSha256))throw new Error('独立 MPV 开发验收记录无效');
  candidate=approved.candidate;
 }
 if(!candidate)return undefined;
 if(!/^mpv-desktop-runtime-[a-z0-9_]{8}$/.test(candidate))throw new Error('无效独立 MPV 开发运行库目录');
 if(approved){
  const bytes=readFileSync(path.join(root,'build',candidate,'runtime.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==approved.manifestSha256||JSON.parse(bytes.toString('utf8')).exeSha256!==approved.exeSha256)throw new Error('独立 MPV 开发验收对象已变化');
 }
 return candidate;
}
