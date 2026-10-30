"""Run the actual Windows FFmpeg baseline against owned original-size fixtures.

Compares decoded native YUV bytes, without encoding or rendering. Missing
optional decoders remain explicit failures of parity, not fake passing samples.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from native_source_replay import owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    folder = owned_build(args.build_dir, "ffmpeg-windows-cross-latest.json", r"ffmpeg-(?:windows-cross|source-replay)-[a-z0-9_]+")
    build = json.loads((folder / "report.json").read_text())
    assert build["buildPassed"]
    for binary in build["binaries"]:
        assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    actual = folder / "install/bin/ffmpeg.exe"
    reference = ROOT / "bin/ffmpeg.exe"
    report = {"kind": "real-windows-native-yuv-frame-comparison-not-electron-or-display-acceptance",
              "completed": False, "samples": [], "featureParityVerified": False, "distributionReady": False}
    for option in ("version", "decoders", "hwaccels"):
        result = subprocess.run([str(actual), "-hide_banner", "-" + option], capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        (folder / ("windows-" + option + ".log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0
    for sample in ("Framecode-v2-640x360.mp4", "Framecode-v2-3840x2160-hevc.mkv",
                   "Precision-SDR10-3840x2160.mkv", "Framecode-v3-3840x2160-av1.mkv"):
        source = ROOT / "build/libmpv-render-spike/samples" / sample
        identity = hashlib.sha256(source.read_bytes()).hexdigest()
        probe = subprocess.run([str(ROOT / "bin/ffprobe.exe"), "-v", "error", "-select_streams", "v:0",
                                "-show_streams", "-of", "json", str(source)], capture_output=True, check=True,
                               timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        stream = json.loads(probe.stdout)["streams"][0]
        args = ["-v", "error", "-nostdin", "-hwaccel", "none", "-threads", "1", "-ss", "1.24",
                "-i", str(source), "-map", "0:v:0", "-frames:v", "1", "-pix_fmt", stream["pix_fmt"], "-f", "rawvideo", "pipe:1"]
        expected = subprocess.run([str(reference), *args], capture_output=True, check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        observed = subprocess.run([str(actual), *args], capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        row = {"sample": sample, "codec": stream["codec_name"], "width": stream["width"], "height": stream["height"],
               "pixelFormat": stream["pix_fmt"], "sourceSha256": identity, "exitCode": observed.returncode,
               "error": observed.stderr.decode("utf8", errors="replace"), "nativeDecodedBytes": len(observed.stdout),
               "referenceSha256": hashlib.sha256(expected.stdout).hexdigest(),
               "actualSha256": hashlib.sha256(observed.stdout).hexdigest(),
               "exactDecodedFrameMatch": observed.returncode == 0 and bool(observed.stdout) and observed.stdout == expected.stdout}
        assert hashlib.sha256(source.read_bytes()).hexdigest() == identity
        report["samples"].append(row)
        (folder / "windows-tests.json").write_text(json.dumps(report, indent=2) + "\n")
        print(sample + (" exact frame match" if row["exactDecodedFrameMatch"] else " NOT passed; recorded"), flush=True)
    report.update(completed=True, exactSamples=sum(s["exactDecodedFrameMatch"] for s in report["samples"]),
                  fixedFrameMatrixPassed=all(s["exactDecodedFrameMatch"] for s in report["samples"]),
                  missingOrDifferentSamples=[s["sample"] for s in report["samples"] if not s["exactDecodedFrameMatch"]])
    if build.get("dav1dDependency"):
        av1 = ROOT / "build/libmpv-render-spike/samples/Framecode-v3-3840x2160-av1.mkv"
        decoded = subprocess.run([str(actual), "-v", "error", "-nostdin", "-hwaccel", "none", "-threads", "1",
                                  "-ss", "1.24", "-c:v", "libdav1d", "-i", str(av1), "-map", "0:v:0",
                                  "-frames:v", "1", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
                                 capture_output=True, check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        expected_row = next(row for row in report["samples"] if row["codec"] == "av1")
        report["explicitDav1d"] = {"decoder": "libdav1d", "decodedBytes": len(decoded.stdout),
                                   "sha256": hashlib.sha256(decoded.stdout).hexdigest(),
                                   "exactReferenceMatch": bool(decoded.stdout) and hashlib.sha256(decoded.stdout).hexdigest() == expected_row["referenceSha256"]}
        report["fixedFrameMatrixPassed"] = report["fixedFrameMatrixPassed"] and report["explicitDav1d"]["exactReferenceMatch"]
        # Exercise the separately compiled high-bit-depth dav1d path with an
        # owned generated gradient. No user source is encoded or modified.
        av1_10 = Path(tempfile.mkdtemp(prefix="dav1d-gradient-", dir=folder)) / "owned-av1-10bit.mkv"
        subprocess.run([str(reference), "-v", "error", "-nostdin", "-f", "lavfi", "-i",
                        "nullsrc=s=128x72:r=1,format=yuv420p10le,geq=lum='64+mod(X*7+Y*3,876)':cb=512:cr=512",
                        "-frames:v", "3", "-c:v", "libaom-av1", "-cpu-used", "8", "-crf", "0", "-b:v", "0",
                        "-threads", "1", "-pix_fmt", "yuv420p10le", "-color_primaries", "bt709", "-color_trc", "bt709",
                        "-colorspace", "bt709", "-n", str(av1_10)], capture_output=True, check=True,
                       timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        identity10 = hashlib.sha256(av1_10.read_bytes()).hexdigest()
        decode10 = ["-v", "error", "-nostdin", "-hwaccel", "none", "-threads", "1"]
        input10 = ["-i", str(av1_10), "-map", "0:v:0", "-frames:v", "3", "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "pipe:1"]
        expected10 = subprocess.run([str(reference), *decode10, *input10], capture_output=True, check=True, timeout=60,
                                    creationflags=subprocess.CREATE_NO_WINDOW).stdout
        observed10 = subprocess.run([str(actual), *decode10, "-c:v", "libdav1d", *input10], capture_output=True, check=True, timeout=60,
                                    creationflags=subprocess.CREATE_NO_WINDOW).stdout
        report["explicitDav1d10Bit"] = {"source": av1_10.relative_to(folder).as_posix(), "sourceSha256": identity10,
            "pixelFormat": "yuv420p10le", "width": 128, "height": 72, "frames": 3,
            "referenceSha256": hashlib.sha256(expected10).hexdigest(), "actualSha256": hashlib.sha256(observed10).hexdigest(),
            "exactReferenceMatch": len(observed10) == 128 * 72 * 3 * 3 and observed10 == expected10}
        assert hashlib.sha256(av1_10.read_bytes()).hexdigest() == identity10
        report["fixedFrameMatrixPassed"] = report["fixedFrameMatrixPassed"] and report["explicitDav1d10Bit"]["exactReferenceMatch"]
        report["missingOrDifferentSamples"].extend(name for name, result in
            [("explicit-libdav1d-8bit", report["explicitDav1d"]), ("explicit-libdav1d-10bit", report["explicitDav1d10Bit"])]
            if not result["exactReferenceMatch"])
    if "#define CONFIG_PNG_ENCODER 1" in (folder / "build/config_components.h").read_text():
        report["pngRoundTrips"] = []
        for sample, pixfmt, bits in (("Framecode-v2-640x360.mp4", "rgb24", 8), ("Precision-SDR10-3840x2160.mkv", "rgb48le", 16)):
            source = ROOT / "build/libmpv-render-spike/samples" / sample
            png = folder / ("owned-screenshot-" + str(bits) + ".png")
            input_args = ["-v", "error", "-nostdin", "-hwaccel", "none", "-threads", "1", "-ss", "1.24", "-i", str(source), "-frames:v", "1"]
            raw = subprocess.run([str(actual), *input_args, "-pix_fmt", pixfmt, "-f", "rawvideo", "pipe:1"],
                                 capture_output=True, check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW).stdout
            subprocess.run([str(actual), *input_args, "-pix_fmt", "rgb48be" if bits == 16 else pixfmt, "-c:v", "png", "-update", "1", "-y", str(png)],
                           capture_output=True, check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
            assert png.read_bytes()[24] == bits
            restored = subprocess.run([str(reference), "-v", "error", "-i", str(png), "-frames:v", "1", "-pix_fmt", pixfmt, "-f", "rawvideo", "pipe:1"],
                                      capture_output=True, check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW).stdout
            assert raw and raw == restored
            report["pngRoundTrips"].append({"source": sample, "pngBitDepth": bits, "decodedRgbBytes": len(raw), "exactRoundTrip": True})
    (folder / "windows-tests.json").write_text(json.dumps(report, indent=2) + "\n")
    build.update(windowsExecutionPassed=report["fixedFrameMatrixPassed"], windowsTestReport="windows-tests.json",
                 exactFrameSamples=report["exactSamples"], featureParityVerified=False)
    (folder / "report.json").write_text(json.dumps(build, indent=2) + "\n")
    print(json.dumps({"report": str(folder / "windows-tests.json"), "exactSamples": report["exactSamples"],
                      "notPassed": report["missingOrDifferentSamples"]}))
    if not report["fixedFrameMatrixPassed"]:
        raise SystemExit(1)
