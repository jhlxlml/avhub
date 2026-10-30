import {useCallback,useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {LibraryPageCache} from './libraryCache';
export {LibraryPageCache} from './libraryCache';

type Snapshot<T>={url:string;revision:number;data?:T;error:string;pending:boolean};
type QueryIdentity={url:string|null;revision:number};
// Only a matching query may supply content. A slow old response can never
// relabel another classification, directory or search result as current.
export function useLibraryQuery<T>(url:string|null,revision:number,cache:LibraryPageCache,search:string,retry=0) {
  const [snapshot,setSnapshot]=useState<Snapshot<T>|null>(null);
  const [feedback,setFeedback]=useState('');
  const previousSearch=useRef(search);
  const previousRetry=useRef(retry);
  const active=useRef({url,revision});active.current={url,revision};
  const cached=url?cache.get<T>(url,revision):undefined;
  const matches=!!url&&snapshot?.url===url&&snapshot.revision===revision;
  const data=url?(matches?snapshot?.data:cached?.data):undefined;
  const loading=!!url&&(matches?snapshot!.pending:!cached||Date.now()-cached.time>cache.freshMs);
  const error=matches?snapshot!.error:'';
  const identity=`${revision}:${url}`;
  useEffect(()=>{
    const typing=previousSearch.current!==search;previousSearch.current=search;
    const forced=previousRetry.current!==retry;previousRetry.current=retry;
    if(!url)return;
    const entry=cache.get<T>(url,revision);
    if(!forced&&entry&&Date.now()-entry.time<=cache.freshMs) {
      setSnapshot({url,revision,data:entry.data,error:'',pending:false});return;
    }
    const controller=new AbortController();
    setSnapshot(current=>({url,revision,data:entry?.data??(current?.url===url&&current.revision===revision?current.data:undefined),error:'',pending:true}));
    const load=async()=>{
      try {
        while(!controller.signal.aborted){
          const generation=cache.generation;
          const result=await api<T>(url,{signal:controller.signal});
          if(controller.signal.aborted)return;
          // A read started before a committed mutation may contain old values,
          // even when URL/revision still match. Fetch a post-write snapshot.
          if(generation!==cache.generation)continue;
          cache.put(url,revision,result);
          setSnapshot({url,revision,data:result,error:'',pending:false});return;
        }
      }catch(e){if(!controller.signal.aborted)setSnapshot(current=>({url,revision,data:current?.url===url&&current.revision===revision?current.data:entry?.data,error:errorText(e),pending:false}));}
    };
    // Classification, pagination and directory changes are immediate. Only
    // text editing needs debounce; never apply it to every query transition.
    const timer=typing?window.setTimeout(()=>void load(),200):undefined;
    if(!typing)void load();
    return()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[url,revision,cache,search,retry]);
  useEffect(()=>{
    setFeedback('');
    if(!loading)return;
    const timer=window.setTimeout(()=>setFeedback(identity),180);
    return()=>clearTimeout(timer);
  },[identity,loading]);
  const update=useCallback((change:(value:T|undefined)=>T|undefined,expected?:QueryIdentity)=>{
    setSnapshot(current=>{
      const {url:key,revision:version}=active.current;
      if(!key)return current;
      if(expected&&(expected.url!==key||expected.revision!==version))return current;
      const valid=current?.url===key&&current.revision===version;
      const entry=cache.get<T>(key,version);
      const next=change(valid?current.data:entry?.data);
      if(next===undefined)return current;
      cache.put(key,version,next,entry?.time);
      return {url:key,revision:version,data:next,error:valid?current.error:'',pending:valid?current.pending:false};
    });
  },[cache]);
  const context=()=>({...active.current});
  const isCurrent=(expected:QueryIdentity)=>expected.url===active.current.url&&expected.revision===active.current.revision;
  return {data,loading,error,showLoading:loading&&feedback===identity,update,context,isCurrent};
}
