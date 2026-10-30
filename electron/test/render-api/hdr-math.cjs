// BT.2100 PQ absolute luminance. Numerical probe only, never a playback permit.
const levels=Object.freeze([0,1,10,80,100,203,400,1000,4000,10000]);
function pqEncode(nits){if(!Number.isFinite(nits)||nits<0||nits>10000)throw new Error('Invalid PQ luminance');const l=(nits/10000)**(2610/16384);return ((3424/4096+(2413/128)*l)/(1+(2392/128)*l))**(2523/32);}
function pqDecode(code){if(!Number.isFinite(code)||code<0||code>1)throw new Error('Invalid PQ code');const e=code**(32/2523);return 10000*(Math.max(e-3424/4096,0)/(2413/128-(2392/128)*e))**(16384/2610);}
// Explicit diagnostic extrapolation for floating-point renderer overshoot.
// It is not part of normative BT.2100 and never changes source acceptance.
function pqDecodeExtended(code){if(!Number.isFinite(code)||Math.abs(code)>1.01)throw new Error('Unverified floating PQ range');const e=Math.abs(code)**(32/2523);return Math.sign(code)*10000*(Math.max(e-3424/4096,0)/(2413/128-(2392/128)*e))**(16384/2610);}
function hdrProbeContract(stream,name,output='pq'){
 if(!['pq','scrgb','raw-pq'].includes(output))throw new Error('Unverified HDR probe output');
 if(!['HDR-PQ10-1024x256.mkv','HDR-PQ10-Color-v2-1024x256.mkv'].includes(name)||stream.width!==1024||stream.height!==256||stream.pix_fmt!=='yuv420p10le'||stream.color_primaries!=='bt2020'||stream.color_transfer!=='smpte2084'||stream.color_space!=='bt2020nc'||stream.color_range!=='tv'||!['1:1',undefined].includes(stream.sample_aspect_ratio)||stream.tags?.rotate||stream.side_data_list?.some(d=>d.rotation))throw new Error('Only the exact generated HDR numerical fixture is allowed');
 return {width:1024,height:256,durationSec:2,diagnosticOnly:true,displayed:false,rawCarrier:output==='raw-pq',sourceColorSpace:{primaries:'bt2020',transfer:'pq',matrix:'bt2020nc',range:'limited'},payload:output==='raw-pq'?'raw PQ RGB numbers; carrier tags are not presentation colorimetry':output,scope:'HDR offscreen numerical probe; not display acceptance',output:{pixelFormat:'rgbaf16',colorSpace:{primaries:output==='pq'?'bt2020':'bt709',transfer:output==='scrgb'?'scrgb-linear-80-nits':output==='raw-pq'?'linear':'pq',matrix:'rgb',range:'full'}}};
}
module.exports={levels,pqEncode,pqDecode,pqDecodeExtended,hdrProbeContract};
