"""Actual Windows candidate comparison; not Electron or physical-display acceptance."""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

import pefile

ROOT = Path(__file__).resolve().parents[1]


def verify():
    if os.name != 'nt':
        raise SystemExit('Run with Windows Python')
    pointer = json.loads((ROOT / 'build/controlled-ffmpeg-latest.json').read_text(encoding='utf-8'))
    folder = ROOT / 'build' / PurePosixPath(pointer['folder'].replace('\\', '/')).name
    build = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    if not build['buildPassed'] or not folder.name.startswith('controlled-ffmpeg-'):
        raise ValueError('A completed owned candidate is required')
    actual = folder / 'install/bin/ffmpeg.exe'
    probe = folder / 'install/bin/ffprobe.exe'
    baseline = ROOT / 'bin/ffmpeg.exe'
    original_probe = ROOT / 'bin/ffprobe.exe'
    output = Path(tempfile.mkdtemp(prefix='controlled-cli-validation-', dir=ROOT / 'build'))
    report = {'kind': 'real-windows-cli-feature-and-decoded-byte-comparison-not-desktop-acceptance',
              'candidate': str(folder), 'passed': False, 'samples': [], 'windowsImports': [],
              'observedBinaries': build['binaries'],
              'sourceProfileSha256': hashlib.sha256(json.dumps(build['sources'], sort_keys=True).encode()).hexdigest(),
              'applicationRuntimeChanged': False, 'distributionReady': False}
    environment = {**os.environ, 'PATH': os.environ['SystemRoot'] + '\\System32;' + os.environ['SystemRoot']}
    for item in build['binaries']:
        file = folder / item['path']
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Candidate binary changed')
        pe = pefile.PE(str(file), fast_load=True)
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
        imports = [entry.dll.decode('ascii').lower() for entry in pe.DIRECTORY_ENTRY_IMPORT]
        pe.close()
        system = {'advapi32.dll', 'avicap32.dll', 'bcrypt.dll', 'crypt32.dll', 'd3d11.dll', 'dxgi.dll', 'gdi32.dll',
                  'imm32.dll', 'kernel32.dll', 'mfplat.dll', 'msvcrt.dll', 'ncrypt.dll', 'ole32.dll',
                  'oleaut32.dll', 'psapi.dll', 'secur32.dll', 'setupapi.dll', 'shell32.dll', 'shlwapi.dll',
                  'user32.dll', 'version.dll', 'winmm.dll', 'ws2_32.dll'}
        if any(name not in system and not name.startswith('api-ms-win-') for name in imports):
            raise ValueError('Candidate imports an unaccounted DLL: ' + repr(imports))
        report['windowsImports'].append({'binary': file.name, 'imports': imports})

    def run(binary, args):
        result = subprocess.run([str(binary), *map(str, args)], capture_output=True, timeout=90,
                                env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError(str(binary) + '\n' + result.stderr.decode('utf-8', errors='replace')[-3000:])
        return result.stdout

    for option in ['version', 'buildconf', 'decoders', 'encoders', 'filters', 'demuxers', 'muxers', 'protocols', 'L']:
        data = run(actual, ['-hide_banner', '-' + option])
        (output / (option + '.txt')).write_bytes(data)
    encoders = (output / 'encoders.txt').read_text(encoding='utf-8')
    required_encoders = ['libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'libopus', 'aac', 'png', 'mjpeg', 'webvtt']
    if any(' ' + name + ' ' not in encoders for name in required_encoders):
        raise ValueError('Actual binary is missing an application/test encoder from the selected profile')
    report['requiredEncodersVerified'] = required_encoders
    codecs = [('h264-mp4', 'libx264', '.mp4', []), ('h264-mkv', 'libx264', '.mkv', []),
              ('h264-ts', 'libx264', '.ts', []), ('h264-mov', 'libx264', '.mov', []),
              ('h264-10', 'libx264', '.mkv', ['-pix_fmt', 'yuv420p10le']),
              ('mpeg4-avi', 'mpeg4', '.avi', []), ('mpeg2-ts', 'mpeg2video', '.ts', []),
              ('wmv-asf', 'wmv2', '.wmv', []), ('flv', 'flv', '.flv', []),
              ('vp8-webm', 'libvpx', '.webm', ['-deadline', 'realtime']),
              ('vp9-webm', 'libvpx-vp9', '.webm', ['-deadline', 'realtime']),
              ('prores-mov', 'prores_ks', '.mov', ['-pix_fmt', 'yuv422p10le'])]
    fixtures = []
    for name, codec, extension, options in codecs:
        file = output / (name + extension)
        run(baseline, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12', '-frames:v', '18',
                       '-c:v', codec, *options, '-color_primaries', 'bt709', '-color_trc', 'bt709',
                       '-colorspace', 'bt709', '-color_range', 'tv', '-y', file])
        fixtures.append(file)
    canonical = ROOT / 'build/libmpv-render-spike/samples'
    fixtures += [canonical / name for name in ['Framecode-v2-640x360.mp4', 'Framecode-v2-3840x2160-hevc.mkv',
                'Precision-SDR10-3840x2160.mkv', 'Framecode-v3-3840x2160-av1.mkv']]
    for file in fixtures:
        before = (file.stat().st_size, file.stat().st_mtime_ns, hashlib.sha256(file.read_bytes()).hexdigest())
        args = ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file]
        original = json.loads(run(original_probe, args))['streams'][0]
        stream = json.loads(run(probe, args))['streams'][0]
        keys = ['codec_name', 'profile', 'width', 'height', 'pix_fmt', 'bits_per_raw_sample',
                'color_range', 'color_space', 'color_transfer', 'color_primaries', 'sample_aspect_ratio']
        if {k: stream.get(k) for k in keys} != {k: original.get(k) for k in keys}:
            raise ValueError('Probe metadata differs: ' + file.name)
        frames = ['-v', 'error', '-hwaccel', 'none', '-threads', '1', '-i', file, '-ss', '0.5',
                  '-map', '0:v:0', '-frames:v', '3', '-pix_fmt', original['pix_fmt'], '-f', 'rawvideo', 'pipe:1']
        expected = run(baseline, frames)
        pixels = run(actual, frames)
        sampling = 1.5 if '420' in original['pix_fmt'] else 2 if '422' in original['pix_fmt'] else 3
        sample_bytes = 2 if '10' in original['pix_fmt'] or '12' in original['pix_fmt'] else 1
        expected_bytes = int(stream['width'] * stream['height'] * sampling * sample_bytes * 3)
        if len(expected) != expected_bytes or pixels != expected:
            raise ValueError('Decoded native frame bytes differ: ' + file.name)
        # This is an application-owned derivative, never an output beside user media.
        image = output / (file.stem + '-16.png')
        run(actual, ['-v', 'error', '-i', file, '-ss', '0.5', '-frames:v', '1', '-pix_fmt', 'rgb48be', '-y', image])
        png = json.loads(run(probe, ['-v', 'error', '-show_streams', '-of', 'json', image]))['streams'][0]
        if (png['width'], png['height'], png['pix_fmt']) != (stream['width'], stream['height'], 'rgb48be'):
            raise ValueError('Screenshot lost dimensions or 16-bit PNG output')
        reference_rgb = run(baseline, ['-v', 'error', '-i', file, '-ss', '0.5', '-frames:v', '1',
                                       '-pix_fmt', 'rgb48be', '-f', 'rawvideo', 'pipe:1'])
        screenshot_rgb = run(actual, ['-v', 'error', '-i', image, '-frames:v', '1',
                                     '-pix_fmt', 'rgb48be', '-f', 'rawvideo', 'pipe:1'])
        if len(reference_rgb) != stream['width'] * stream['height'] * 6 or screenshot_rgb != reference_rgb:
            raise ValueError('PNG pixels differ from reference conversion: ' + file.name)
        if before != (file.stat().st_size, file.stat().st_mtime_ns, hashlib.sha256(file.read_bytes()).hexdigest()):
            raise ValueError('Source changed')
        report['samples'].append({'source': str(file), 'codec': stream['codec_name'], 'pixFmt': stream['pix_fmt'],
            'width': stream['width'], 'height': stream['height'], 'decodedFramesCompared': 3,
            'nativeFrameBytesEqual': True, 'sourceSha256': before[2], 'sourceUnchanged': True,
            'originalSize16BitPng': True, 'screenshotRgb48BytesEqual': True,
            'comparisonUsesDecodeFromStartOutputSeek': True})
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    srt = output / '字幕.srt'
    srt.write_text('1\n00:00:00,200 --> 00:00:01,200\n字幕 <i>Caption</i>\n', encoding='utf-8')
    ass = output / '字幕.ass'
    run(baseline, ['-v', 'error', '-i', srt, '-c:s', 'ass', '-y', ass])
    subtitles = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'ass', '-i', ass,
                 '-map', '0:s:0', '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1']
    if run(actual, subtitles) != run(baseline, subtitles):
        raise ValueError('ASS to WebVTT differs')
    # H.264 + two AAC streams + embedded subtitle: compare every encoded packet
    # after the same lossless remux, including data hashes and stream order.
    media = output / 'multitrack.mkv'
    run(baseline, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12',
        '-f', 'lavfi', '-i', 'sine=frequency=440', '-f', 'lavfi', '-i', 'sine=frequency=880', '-i', srt,
        '-t', '2', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
        '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'srt', '-y', media])
    copies = [output / 'reference-remux.mkv', output / 'candidate-remux.mkv']
    for binary, destination in zip([baseline, actual], copies):
        run(binary, ['-v', 'error', '-i', media, '-map', '0', '-c', 'copy', '-y', destination])
    packet_args = ['-v', 'error', '-show_packets', '-show_data_hash', 'sha256',
                   '-show_entries', 'packet=stream_index,data_hash', '-of', 'json']
    expected = json.loads(run(original_probe, [*packet_args, copies[0]]))
    observed = json.loads(run(probe, [*packet_args, copies[1]]))
    if not expected['packets'] or observed != expected:
        raise ValueError('Stream-copy encoded packets differ')
    report.update(passed=True, assToWebVttEqual=True, copiedPacketCount=len(expected['packets']),
                  copiedVideoAudioSubtitlePacketsEqual=True, developerPathsRemoved=True)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'build/controlled-cli-validation-latest.json').write_text(json.dumps({'folder': str(output), 'passed': True}) + '\n')
    print(json.dumps({'folder': str(output), 'passed': True, 'samples': len(fixtures)}, ensure_ascii=False))


if __name__ == '__main__':
    verify()
