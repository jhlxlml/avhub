// Fail closed at the PoC boundary. Never reinterpret unverified HDR/bit depth.
function sourceContract(stream,options={}){
 if(!stream)throw new Error('Video stream missing');
 const {width,height,pix_fmt,color_primaries,color_transfer,color_space,color_range}=stream;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<16||height<16||width>8192||height>8192)throw new Error('Invalid original dimensions');
 const floatingPoint=options.floatingPoint===true,tenBit=pix_fmt==='yuv420p10le';
 const textureBudgetBytes=width*height*(floatingPoint?8:4)*3;
 const textureLimitBytes=(floatingPoint?256:128)*1024*1024;
 if(textureBudgetBytes>textureLimitBytes)throw new Error('Original dimensions exceed texture budget; downscaling is forbidden');
 if(pix_fmt!=='yuv420p'&&!(tenBit&&floatingPoint&&options.diagnosticSdr10===true))throw new Error('Unverified source bit depth/format; RGBA8 conversion is forbidden');
 if(Number(stream.bits_per_raw_sample)>8&&!(tenBit&&floatingPoint&&options.diagnosticSdr10===true&&Number(stream.bits_per_raw_sample)<=10))throw new Error('Unverified source bit depth; RGBA8 conversion is forbidden');
 if(color_primaries!=='bt709'||color_transfer!=='bt709'||color_space!=='bt709'||!['tv','pc'].includes(color_range))throw new Error('Unverified color/HDR metadata; tone mapping or color assumptions are forbidden');
 if(!['1:1',undefined].includes(stream.sample_aspect_ratio))throw new Error('Non-square pixels need an explicit display contract');
 const rotation=Number(stream.tags?.rotate||0);if(!Number.isFinite(rotation)||rotation%360!==0||stream.side_data_list?.some(d=>d.rotation!==undefined&&Number(d.rotation)%360!==0))throw new Error('Rotation needs an explicit display contract');
 return {width,height,pix_fmt,color_primaries,color_transfer,color_space,color_range,textureBudgetBytes,textureLimitBytes,
  durationSec:Number.isFinite(Number(stream.duration))&&Number(stream.duration)>0?Number(stream.duration):null,
  output:{pixelFormat:floatingPoint?'rgbaf16':'rgba',colorSpace:{primaries:'bt709',transfer:'srgb',matrix:'rgb',range:'full'}},scope:tenBit?'diagnostic 10-bit BT.709 SDR via RGBA16F, not production acceptance':'8-bit BT.709 SDR only; original dimensions'};
}
function mergeProbe(probe){
 const stream=probe.streams?.[0],frame=probe.frames?.find(f=>f.media_type==='video');if(!stream||!frame)throw new Error('Stream and decoded first-frame evidence are required');
 const merged={...stream},colorEvidence={};
 if(!(Number.isFinite(Number(stream.duration))&&Number(stream.duration)>0)&&Number.isFinite(Number(probe.format?.duration))&&Number(probe.format.duration)>0)merged.duration=probe.format.duration;
 for(const key of ['width','height','pix_fmt','color_primaries','color_transfer','color_space','color_range']){
  const a=stream[key],b=frame[key],known=v=>v!==undefined&&v!==null&&v!=='unknown';
  if(known(a)&&known(b)&&a!==b)throw new Error('Conflicting stream/frame metadata: '+key);
  merged[key]=known(a)?a:b;colorEvidence[key]=known(a)?'stream':'decoded-first-frame';
 }
 return {...merged,colorEvidence};
}
const generatedSampleNames=Object.freeze(['Framecode-v3-3840x2160-av1.mkv','Precision-SDR10-2160x3840.mkv','long-run/Precision-SDR10-Long-v1-3840x2160.mkv','HDR-PQ10-Color-v2-1024x256.mkv','HDR-PQ10-1024x256.mkv','Framecode-v2-640x360.mp4','Framecode-v2-1920x1080.mp4','Framecode-v2-3840x2160.mp4','Framecode-v2-3840x2160-hevc.mkv','Framecode-v3-1920x1080-av1.mkv','Precision-SDR10-1024x256.mkv','Precision-SDR10-3840x2160.mkv','Precision-SDR10-Continuous-3840x2160.mkv']);
module.exports={sourceContract,mergeProbe,generatedSampleNames};
