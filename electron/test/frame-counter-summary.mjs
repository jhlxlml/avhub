// Sparse MPV counters reset on seek/VO reset. Never label the last reading total.
export function summarizeFrameCounter(samples){
 let firstReading=null,lastReading=null,lastSeek=null,observedIncreaseLowerBound=0,counterDecreases=0,seekBoundaries=0,validSamples=0,missingSamples=0;
 for(const sample of samples){
  const value=sample.value;
  if(!Number.isSafeInteger(value)||value<0){missingSamples++;continue;}
  const seek=Number.isSafeInteger(sample.seekId)&&sample.seekId>=0?sample.seekId:null;
  if(lastReading!==null){
   const boundary=seek!==null&&lastSeek!==null&&seek!==lastSeek;
   if(boundary)seekBoundaries++;
   if(value<lastReading)counterDecreases++;
   // A new seek ID alone does not prove when this sampled counter reset.
   // Count only the positive difference unless an actual decrease is seen.
   observedIncreaseLowerBound+=value<lastReading?value:value-lastReading;
  }else firstReading=value;
  lastReading=value;lastSeek=seek;validSamples++;
 }
 return {scope:'sparse-observed-increase-lower-bound-not-session-total',firstReading,lastReading,observedIncreaseLowerBound,counterDecreases,seekBoundaries,validSamples,missingSamples,totalIsExact:false};
}
