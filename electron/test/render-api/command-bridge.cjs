// Isolated PoC native command transport. No renderer API or arbitrary execution.
function createCommandBridge({stream,onFailure=()=>{},timeoutMs=10000}){
 const pending=new Map();let sequence=0,failure,disposed=false;
 function fail(error){if(failure)return;failure=error instanceof Error?error:new Error(String(error));for(const p of pending.values()){clearTimeout(p.timer);p.reject(failure);}pending.clear();if(!disposed)onFailure(failure);}
 stream.on('error',fail);stream.on('close',()=>fail(new Error('Native command pipe closed')));
 function command(action,extra={}){
  if(failure||disposed||stream.destroyed||!stream.writable)return Promise.reject(failure||new Error('Native command pipe unavailable'));
  if(typeof action!=='string'||!action||action.length>64||!extra||typeof extra!=='object'||Array.isArray(extra))return Promise.reject(new Error('Invalid native command'));
  const id=++sequence;let payload;try{payload=JSON.stringify({...extra,id,action})+'\n';if(Buffer.byteLength(payload)>4096)throw new Error('Native command too large');}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error('Host command timeout: '+action)),timeoutMs);pending.set(id,{resolve,reject,timer});try{stream.write(payload,error=>{if(error)fail(error);});}catch(error){fail(error);}});
 }
 function accept(reply){if(!reply||!Number.isSafeInteger(reply.id))return false;const p=pending.get(reply.id);if(!p)return false;pending.delete(reply.id);clearTimeout(p.timer);reply.error?p.reject(new Error(String(reply.error))):p.resolve(reply.result);return true;}
 function dispose(){disposed=true;fail(new Error('Native command bridge disposed'));}
 // Keep the stream error listener until the stream itself is collected: a late
 // OS pipe error must not become an uncaught EventEmitter 'error' on shutdown.
 return {command,accept,fail,dispose,get pendingCount(){return pending.size;}};
}
module.exports={createCommandBridge};
