"""Run libass's actual Windows assembly tests and multilingual PNG renderer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import time
from native_source_replay import owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    folder = owned_build(args.build_dir, "subtitle-windows-cross-latest.json", r"subtitle-(?:windows-cross|source-replay)-[a-z0-9_]+")
    build = json.loads((folder / "report.json").read_text()); assert build["buildPassed"]
    for binary in build["binaries"]:
        assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    prefix = folder / "install/bin"
    env = {**os.environ, "PATH": str(prefix) + os.pathsep + os.environ["PATH"]}
    report = {"kind": "actual-windows-libass-asm-and-subtitle-image-not-electron-acceptance",
              "checkasmPassed": False, "images": [], "passed": False, "distributionReady": False}
    report_file = folder / "windows-tests.json"
    report_file.write_text(json.dumps(report, indent=2) + "\n")
    start = time.monotonic()
    with (folder / "windows-checkasm.log").open("wb") as stream:
        result = subprocess.run([str(folder / "libass-build/checkasm/checkasm.exe")], cwd=prefix, env=env,
                                stdout=stream, stderr=subprocess.STDOUT, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
    report.update(checkasmPassed=result.returncode == 0, checkasmExitCode=result.returncode,
                  checkasmSeconds=time.monotonic()-start)
    summary = re.search(r"all (\d+) tests passed", (folder / "windows-checkasm.log").read_text(encoding="utf8", errors="replace"))
    report["officialAsmTestsPassed"] = int(summary.group(1)) if summary else 0
    report_file.write_text(json.dumps(report, indent=2) + "\n"); assert result.returncode == 0
    sample = folder / "owned-multilingual.ass"
    sample.write_text('''[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Malgun Gothic,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,50,50,60,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\b1}AVHub 中文 한국어 العربية{\\b0}\\N字幕 · Subtitles
Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\c&HFF8844&\\i1}第二段 · Next cue{\\i0}
''', encoding="utf8")
    decoded = []
    for timestamp in (1, 3, 5):
        png = folder / ("subtitle-" + str(timestamp) + ".png")
        with (folder / ("windows-render-" + str(timestamp) + ".log")).open("wb") as stream:
            result = subprocess.run([str(folder / "libass-build/test/libass_test.exe"), str(png), str(sample), str(timestamp), "1280", "720"],
                                    cwd=prefix, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
        assert result.returncode == 0
        log = (folder / ("windows-render-" + str(timestamp) + ".log")).read_text(encoding="utf8", errors="replace")
        assert "failed to find any fallback with glyph" not in log
        image = png.read_bytes(); assert struct.unpack('>II', image[16:24]) == (1280, 720)
        raw = subprocess.run([str(ROOT / "bin/ffmpeg.exe"), "-v", "error", "-i", str(png), "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
                             capture_output=True, check=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW).stdout
        decoded.append(raw)
        report["images"].append({"time": timestamp, "width": 1280, "height": 720, "pngSha256": hashlib.sha256(image).hexdigest()})
    changes = [sum(a != b for a, b in zip(image, decoded[2])) for image in decoded[:2]]
    assert all(n > 1000 for n in changes) and decoded[0] != decoded[1]
    report.update(passed=True, visibleCuesDifferFromEmptyBytes=changes, missingGlyphFallbackDetected=False)
    report_file.write_text(json.dumps(report, indent=2) + "\n")
    build.update(windowsTestsPassed=True, windowsTestReport="windows-tests.json")
    (folder / "report.json").write_text(json.dumps(build, indent=2) + "\n")
    print(json.dumps({"passed": True, "report": str(report_file)}))
