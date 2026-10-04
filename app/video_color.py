"""Explicit browser-compatible color conversion; no claim of HDR losslessness."""
import re
from fractions import Fraction
from fastapi import HTTPException

PRIMARIES = {'bt709','bt470m','bt470bg','smpte170m','smpte240m','film','bt2020','smpte428','smpte431','smpte432'}
MATRICES = {'bt709','fcc','bt470bg','smpte170m','smpte240m','bt2020nc','bt2020c','gbr','ycgco'}


def sdr_vui_args(color):
    values=[]
    for option,key,allowed in (('colorprim','primaries',PRIMARIES),('colormatrix','matrix',MATRICES),
                               ('transfer','transfer',{'bt709','gamma22','gamma28','smpte170m','smpte240m','linear','iec61966-2-1','bt2020-10','bt2020-12'}),
                               ('range','range',{'tv','pc'})):
        if color.get(key) in allowed:
            value={'gbr':'GBR','ycgco':'YCgCo'}.get(color[key],color[key])
            values.append(f'{option}={value}')
    return ['-x264-params',':'.join(values)] if values else []


def color_metadata(stream):
    pixel = stream.get('pix_fmt') or ''
    match = re.search(r'(?:p|gray)(9|10|12|14|16)(?:le|be)?$',pixel)
    try: bits = int(stream.get('bits_per_raw_sample') or 0)
    except (ValueError,TypeError): bits=0
    if bits<=0: bits=int(match.group(1)) if match else 10 if pixel in {'p010le','p010be','p210le'} else 32 if pixel.startswith('gbrpf32') else 16 if pixel.startswith(('rgb48','rgba64')) else 8
    transfer = stream.get('color_transfer') or 'unknown'
    hdr = 'PQ' if transfer=='smpte2084' else 'HLG' if transfer=='arib-std-b67' else None
    side = stream.get('side_data_list') or []
    dovi = next((entry for entry in side if 'dovi' in entry.get('side_data_type','').lower() or 'dolby' in entry.get('side_data_type','').lower()),{})
    peak = None
    for entry in side:
        for key in ('max_content','max_luminance'):
            try:
                value = float(Fraction(str(entry.get(key,0))))
                if 100<=value<=10000: peak = max(peak or 0,value)
            except (ValueError,ZeroDivisionError): pass
    return {'version':1,'verified':bool(stream.get('codec_name')),'pix_fmt':pixel,'bit_depth':bits,'transfer':transfer,
            'primaries':stream.get('color_primaries') or 'unknown','matrix':stream.get('color_space') or 'unknown',
            'range':stream.get('color_range') or 'unknown','hdr':hdr,'peak_nits':peak,
            'dolby_vision_profile':dovi.get('dv_profile'),'dynamic_hdr':bool(dovi) or any('hdr10+' in entry.get('side_data_type','').lower() for entry in side)}


def transcode_color(color):
    color = color or {}
    dv = color.get('dolby_vision_profile')
    if dv is not None and (dv not in (7,8) or not color.get('hdr')):
        raise HTTPException(422,'该 Dolby Vision 源没有受支持的 HDR10/HLG 基层，暂不进行兼容转码，请使用原片直放或其他播放器')
    if color.get('hdr') in ('PQ','HLG'):
        defaults=[]
        primaries=color.get('primaries');matrix=color.get('matrix');range_=color.get('range')
        if primaries not in PRIMARIES: primaries='bt2020';defaults.append('色域')
        if matrix not in MATRICES: matrix='bt2020nc';defaults.append('矩阵')
        if range_ not in ('tv','pc'): range_='tv';defaults.append('范围')
        transfer='smpte2084' if color['hdr']=='PQ' else 'arib-std-b67'
        peak=color.get('peak_nits') or (1000 if color['hdr']=='HLG' else 10000)
        peak=max(100,min(10000,float(peak)))/100
        filters=(f'zscale=pin={primaries}:tin={transfer}:min={matrix}:rin={range_}:t=linear:npl=100,'
                 f'format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=2:peak={peak:g},'
                 "zscale=w='trunc(iw/2)*2':h='trunc(ih/2)*2':t=bt709:m=bt709:r=tv:d=error_diffusion,format=yuv420p,sidedata=mode=delete")
        warning='HDR 映射为 SDR BT.709 / 8-bit，不保留 HDR 动态范围；不是原画或无损转换'
        if color.get('dynamic_hdr'): warning+='；只使用兼容基层，不应用动态 HDR 元数据'
        if defaults: warning+='；未标明的'+ '、'.join(defaults)+'按 BT.2020 / limited 兼容默认值处理'
        # libx264 VUI explicitly marks the encoded bitstream. Some FFmpeg builds
        # lose primaries/transfer when generic encoder flags are also supplied.
        return {'filter':filters,'args':['-x264-params','colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv','-map_metadata','-1'],
                'label':f"{color['hdr']} HDR → SDR · BT.709 · 8-bit",'warning':warning}
    if color.get('bit_depth',8)>8:
        return {'filter':"zscale=w='trunc(iw/2)*2':h='trunc(ih/2)*2':d=error_diffusion,format=yuv420p",
                'label':f"{color['bit_depth']}-bit → 8-bit · 抖动量化",'warning':'兼容转码降低位深，抖动用于减轻色带，不能保留全部源画质', 'args':sdr_vui_args(color)}
    return {'filter':'','args':sdr_vui_args(color),'label':('SDR' if color.get('transfer') not in (None,'unknown') else '色彩未标定')+' 兼容编码 · 8-bit','warning':'H.264 CRF 18 为有损编码，不等于原画'}
