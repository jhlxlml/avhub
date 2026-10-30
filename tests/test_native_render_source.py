import unittest
from fastapi import HTTPException
from app.native_playback import render_source_contract, probe_render_source


def fixture(**extra):
    stream = dict(codec_name='hevc', width=3840, height=2160, pix_fmt='yuv420p10le',
                  color_primaries='bt709', color_transfer='bt709', color_space='bt709', color_range='tv',
                  sample_aspect_ratio='1:1')
    stream.update(extra)
    return {'streams': [stream], 'frames': [dict(stream, media_type='video')]}


class RenderContractTest(unittest.TestCase):
    def test_original_size_and_ten_bit_contract(self):
        result = render_source_contract(fixture())
        self.assertEqual((result['width'], result['height'], result['depth']), (3840, 2160, 10))
        self.assertFalse(result['hdr'])

    def test_invalid_geometry_still_rejected(self):
        for key, value in [('width', True), ('height', 0)]:
            p = fixture(); p['streams'][0][key] = value; p['frames'][0][key] = value
            with self.subTest(key=key), self.assertRaises((ValueError, TypeError)):
                render_source_contract(p)

    def test_no_sample_whitelist_and_decoded_metadata_precedence(self):
        p = fixture(); p['frames'] = []
        self.assertEqual(render_source_contract(p)['width'], 3840)
        p = fixture(); p['frames'][0]['color_space'] = 'bt2020nc'
        self.assertEqual(render_source_contract(p)['matrix'], 'bt2020nc')
        for pixel in ['yuv420p12le', 'yuv444p', 'yuv422p10le', 'gbrp16le', 'rgb24']:
            p = fixture(); p['streams'][0]['pix_fmt'] = pixel; p['frames'][0]['pix_fmt'] = pixel
            self.assertGreater(render_source_contract(p)['depth'], 0)
        p = fixture(); p['streams'][0]['width'] = p['frames'][0]['width'] = 7680
        p['streams'][0]['height'] = p['frames'][0]['height'] = 4320
        self.assertEqual(render_source_contract(p)['width'], 7680)

    def test_rotation_and_pixel_aspect_keep_full_picture(self):
        self.assertEqual(render_source_contract(fixture(tags={'rotate': '90'}))['width'], 2160)
        result = render_source_contract(fixture(sample_aspect_ratio='2:1'))
        self.assertEqual((result['width'], result['height']), (7680, 2160))
        self.assertEqual((result['sourceWidth'], result['sourceHeight']), (3840, 2160))

    def test_bounded_probe_does_not_mutate_or_transcode(self):
        import json
        calls = []
        def run(args, timeout):
            calls.append((args, timeout)); return 0, json.dumps(fixture()).encode(), b''
        self.assertEqual(probe_render_source('owned.mkv', run, 'ffprobe')['depth'], 10)
        self.assertEqual(calls[0][1], 5)
        self.assertIn('%+#32', calls[0][0]); self.assertNotIn('-show_frames', calls[0][0])
        for output in (b'{}', b'bad', b' ' * (2 * 1024**2 + 1)):
            with self.assertRaises(HTTPException):
                probe_render_source('owned.mkv', lambda *args: (0, output, b''), 'ffprobe')

    def test_untagged_recording_uses_mpv_without_inventing_tags(self):
        import copy
        import json
        p = fixture()
        for item in (p['streams'][0], p['frames'][0]):
            item.update(codec_name='h264', width=2510, height=1302, pix_fmt='yuv420p')
            for key in ('color_primaries', 'color_transfer', 'color_space', 'color_range'):
                item.pop(key, None)
        before = copy.deepcopy(p)
        result = probe_render_source('recording.mp4', lambda *args: (0, json.dumps(p).encode(), b''), 'ffprobe')
        self.assertEqual((result['width'], result['height'], result['depth']), (2510, 1302, 8))
        for key in ('primaries', 'transfer', 'matrix', 'range'):
            self.assertEqual(result[key], 'unknown')
        self.assertEqual(p, before)

    def test_partial_tags_remain_evidence_and_unknown_ten_bit_keeps_precision(self):
        p = fixture()
        p['streams'][0].pop('color_transfer')
        p['frames'][0].pop('color_transfer')
        result = render_source_contract(p)
        self.assertEqual(result['transfer'], 'unknown')
        self.assertEqual(result['primaries'], 'bt709')
        self.assertEqual(result['depth'], 10)

    def test_hdr_is_described_without_a_playback_whitelist(self):
        for transfer in ('smpte2084', 'arib-std-b67'):
            result = render_source_contract(fixture(color_transfer=transfer))
            self.assertTrue(result['hdr'])
            self.assertEqual(result['transfer'], transfer)
            self.assertEqual(result['depth'], 10)

    def test_decoded_frame_dynamic_hdr_is_evidence_not_rejection(self):
        p = fixture()
        p['frames'][0]['side_data_list'] = [{'side_data_type': 'DOVI configuration record'}]
        self.assertTrue(render_source_contract(p)['hdr'])

    def test_probe_failure_reason_is_actionable(self):
        import json
        with self.assertRaises(HTTPException) as result:
            probe_render_source('owned.mkv', lambda *args: (1, json.dumps(fixture()).encode(), b''), 'ffprobe')
        self.assertIn('读取限制', result.exception.detail)


if __name__ == '__main__': unittest.main()
