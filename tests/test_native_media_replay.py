"""Media replay evidence and synthetic quality-gate negative controls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import shutil

ROOT = Path(__file__).resolve().parents[1]


class MediaValidationNegativeTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows decoder verifier negative control")
    def test_empty_decoder_output_never_marks_windows_execution_passed(self):
        # Deliberate empty-output executable, never a real decoder acceptance.
        # Reference fixtures are freshly generated tiny H264 videos, regardless
        # of the legacy matrix filenames. No 4K/HEVC/AV1 proof is claimed here.
        with tempfile.TemporaryDirectory(prefix="ffmpeg-source-replay-", dir=ROOT / "build") as name:
            isolated=Path(name)
            scripts=isolated/'scripts';scripts.mkdir()
            for script in ['verify-ffmpeg-windows-harness.py','native_source_replay.py']:
                shutil.copyfile(ROOT/'scripts'/script,scripts/script)
            (isolated/'bin').mkdir()
            for executable in ['ffmpeg.exe','ffprobe.exe']:shutil.copyfile(ROOT/'bin'/executable,isolated/'bin'/executable)
            samples=isolated/'build/libmpv-render-spike/samples';samples.mkdir(parents=True)
            reference=samples/'Framecode-v2-640x360.mp4'
            subprocess.run([str(isolated/'bin/ffmpeg.exe'),'-v','error','-f','lavfi','-i','color=s=16x16:r=5','-t','2','-c:v','libx264','-pix_fmt','yuv420p',str(reference)],check=True,capture_output=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
            for sample in ['Framecode-v2-3840x2160-hevc.mkv','Precision-SDR10-3840x2160.mkv','Framecode-v3-3840x2160-av1.mkv']:shutil.copyfile(reference,samples/sample)
            folder=isolated/'build/ffmpeg-source-replay-fixture'
            self.assertTrue(folder.resolve().is_relative_to((ROOT / "build").resolve()))
            binary = folder / "install/bin/ffmpeg.exe"
            binary.parent.mkdir(parents=True)
            source = folder / "empty-output.cs"
            source.write_text("class Fixture { static int Main() { return 0; } }")
            compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
            subprocess.run([str(compiler), "/nologo", "/platform:x64", "/out:" + str(binary), str(source)],
                           check=True, capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
            (folder / "build").mkdir()
            (folder / "build/config_components.h").write_text("#define CONFIG_PNG_ENCODER 0\n")
            (folder / "report.json").write_text(json.dumps({"kind": "synthetic-empty-decoder-negative-control",
                "buildPassed": True, "distributionReady": False,
                "binaries": [{"path": "install/bin/ffmpeg.exe", "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}]}))
            result = subprocess.run([sys.executable, str(scripts / "verify-ffmpeg-windows-harness.py"),
                                     "--build-dir", str(folder)], capture_output=True, text=True,
                                    timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            report = json.loads((folder / "windows-tests.json").read_text())
            self.assertFalse(report["fixedFrameMatrixPassed"])
            self.assertEqual(report["exactSamples"], 0)
            self.assertEqual(len(report["samples"]), 4)
            self.assertFalse(json.loads((folder / "report.json").read_text())["windowsExecutionPassed"])


@unittest.skipUnless((ROOT/'build/ffmpeg-source-replay-wesx64x9/report.json').is_file(),'BLOCKED: requires real media dependency replay; mandatory in verify-local-build-evidence.py before release')
class ActualMediaReplayTests(unittest.TestCase):
    def test_media_chain_uses_one_frozen_input_and_keeps_current_markers(self):
        stages = [ROOT / "build" / name for name in ["dav1d-source-replay-4_j6b2d7",
                  "subtitle-source-replay-c6vp31en", "ffmpeg-source-replay-wesx64x9"]]
        reports = [json.loads((folder / "report.json").read_text()) for folder in stages]
        self.assertEqual(len({r["sourceMaterialsReplay"]["inventorySha256"] for r in reports}), 1)
        self.assertEqual(reports[-1]["dav1dDependency"], "build/" + stages[0].name)
        self.assertEqual(reports[-1]["zlibDependency"], "build/" + stages[1].name)
        self.assertEqual(reports[0]["configuredBitdepthFamilies"], [8, 16])
        for folder, report in zip(stages, reports):
            self.assertTrue(report["buildPassed"])
            self.assertFalse(report["distributionReady"])
            for binary in report["binaries"]:
                with (folder / binary["path"]).open("rb") as stream:
                    self.assertEqual(hashlib.file_digest(stream, "sha256").hexdigest(), binary["sha256"])
        for marker, expected in [("dav1d-windows-cross-latest.json", "dav1d-windows-cross-cs5m_0nk"),
                                 ("subtitle-windows-cross-latest.json", "subtitle-windows-cross-3on2liyj"),
                                 ("ffmpeg-windows-cross-latest.json", "ffmpeg-windows-cross-_f24han_")]:
            self.assertEqual(Path(json.loads((ROOT / "build" / marker).read_text())["folder"]).name, expected)

    def test_actual_decoded_frames_precision_png_and_subtitles_passed(self):
        folder = ROOT / "build/ffmpeg-source-replay-wesx64x9"
        report = json.loads((folder / "windows-tests.json").read_text())
        self.assertTrue(report["fixedFrameMatrixPassed"])
        self.assertEqual(report["exactSamples"], 4)
        self.assertTrue(all(row["exactDecodedFrameMatch"] for row in report["samples"]))
        self.assertTrue(report["explicitDav1d"]["exactReferenceMatch"])
        self.assertTrue(report["explicitDav1d10Bit"]["exactReferenceMatch"])
        self.assertEqual(report["explicitDav1d10Bit"]["pixelFormat"], "yuv420p10le")
        self.assertEqual(report["explicitDav1d10Bit"]["frames"], 3)
        self.assertEqual([row["pngBitDepth"] for row in report["pngRoundTrips"]], [8, 16])
        self.assertTrue(all(row["exactRoundTrip"] for row in report["pngRoundTrips"]))
        self.assertTrue(json.loads((folder / "report.json").read_text())["windowsExecutionPassed"])
        subtitle = json.loads((ROOT / "build/subtitle-source-replay-c6vp31en/windows-tests.json").read_text())
        self.assertTrue(subtitle["passed"])
        self.assertEqual(subtitle["officialAsmTestsPassed"], 66)
        self.assertEqual(len(subtitle["images"]), 3)
        self.assertFalse(subtitle["missingGlyphFallbackDetected"])
