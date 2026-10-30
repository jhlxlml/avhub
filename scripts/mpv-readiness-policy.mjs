import assert from 'node:assert/strict';
export const distributionRoles=['notices','correspondingSources','buildMaterials','desktopAcceptance','packagedAcceptance'];
export function validateMpvManifest(manifest){
 assert.equal(manifest.schema,1);
 for(const key of ['archiveSha256','exeSha256','licenseSha256'])assert.match(manifest[key],/^[a-f0-9]{64}$/);
 assert.match(manifest.asset,/^mpv-[\w.-]+\.zip$/);
 const tag=manifest.releaseTag??'git-release';assert.match(tag,/^(git-release|v\d+\.\d+\.\d+)$/);
 assert.equal(manifest.url,`https://github.com/mpv-player/mpv/releases/download/${tag}/${manifest.asset}`);
}

// Evidence integrity is a build gate, never an automatic legal sign-off.
export function distributionProblems(manifest,evidence,verifyFile){
 const problems=[];
 if(manifest.distributionReady!==true)problems.push('Distribution has not been approved');
 if(!/^v\d+\.\d+\.\d+$/.test(manifest.releaseTag??''))problems.push('A fixed upstream release tag is required');
 if(!/^[a-f0-9]{40}$/.test(manifest.sourceCommit??''))problems.push('The complete upstream source commit is required');
 if(!Array.isArray(manifest.releaseBlockers)||manifest.releaseBlockers.length)problems.push('Declared release blockers remain unresolved');
 const bound=evidence?.schema===1&&['archiveSha256','exeSha256','licenseSha256'].every(k=>evidence[k]===manifest[k]);
 if(!bound)problems.push('Distribution evidence is absent or belongs to a different runtime');
 for(const role of distributionRoles){
  const record=evidence?.[role];
  if(!bound||record?.state!=='complete'||!Array.isArray(record.files)||!record.files.length){problems.push(`${role}: reviewed evidence is incomplete`);continue;}
  for(const file of record.files){
   try{
    if(!file||typeof file.path!=='string'||!(/^[a-f0-9]{64}$/).test(file.sha256)||verifyFile(file,role)!==true)throw new Error();
   }catch{problems.push(`${role}: evidence file is missing, changed or invalid`);break;}
  }
 }
 return problems;
}
