"""Actual self-built DLL API/decoder smoke, deliberately using a null VO.

This proves library loading, decoding metadata and control state, not GPU
presentation, accurate visible seek, Electron integration or performance.
"""
import argparse
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path, help="Explicit owned normal/replay build; never changes current candidate")
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    selected = args.build_dir if args.build_dir else Path(json.loads((ROOT / "build/libmpv-windows-cross-latest.json").read_text())["folder"]).name
    name = Path(selected).name
    if not re.fullmatch(r"libmpv-(?:windows-cross|source-replay|chain-replay)-[a-z0-9_]+", name):
        raise ValueError("Expected an owned build")
    folder = ROOT / "build" / name
    if args.build_dir and args.build_dir.absolute() != folder:
        raise ValueError("Explicit build must be a project-owned directory")
    build = json.loads((folder / "report.json").read_text()); assert build["buildPassed"]
    for binary in build["binaries"]:
        assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    prefix = folder / "install/bin"
    result = {"kind": "actual-self-built-windows-libmpv-null-vo-api-not-desktop-acceptance",
              "samples": [], "officialCoreTests": [], "passed": False, "electronAccepted": False, "distributionReady": False}
    result_file = folder / "windows-tests.json"
    result_file.write_text(json.dumps(result, indent=2) + "\n")
    env = {**os.environ, "PATH": str(prefix) + os.pathsep + os.environ["PATH"]}
    version = subprocess.run([str(prefix / "mpv.exe"), "--no-config", "--version"], cwd=prefix, env=env,
                             capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    (folder / "windows-version.log").write_bytes(version.stdout + version.stderr); assert version.returncode == 0
    ff_stage = ROOT / build["dependencyStages"]["ffmpeg"]
    ff_build = json.loads((ff_stage / "report.json").read_text())
    assert ("FFmpeg version: git-" + ff_build["sourceRevision"][:12]).encode() in version.stdout
    assert b"(runtime " not in version.stdout, "Compile-time/runtime FFmpeg version mismatch"
    for test in ("chmap", "codepoint-width", "format", "gl-video", "json", "language", "linked-list", "paths", "swresample", "timer"):
        binary = folder / "build/test" / (test + ".exe")
        with (folder / ("windows-unit-" + test + ".log")).open("wb") as stream:
            executed = subprocess.run([str(binary)], cwd=prefix, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                      timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        result["officialCoreTests"].append({"name": test, "exitCode": executed.returncode})
        result_file.write_text(json.dumps(result, indent=2) + "\n")
        assert executed.returncode == 0, "Official core test failed: " + test
    with os.add_dll_directory(str(prefix)):
        api = c.CDLL(str(prefix / "libmpv-2.dll"))
        api.mpv_client_api_version.restype = c.c_uint64
        api.mpv_create.restype = c.c_void_p
        api.mpv_set_option_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
        api.mpv_initialize.argtypes = [c.c_void_p]
        api.mpv_command.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
        api.mpv_get_property.argtypes = [c.c_void_p, c.c_char_p, c.c_int, c.c_void_p]
        api.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]; api.mpv_get_property_string.restype = c.c_void_p
        api.mpv_free.argtypes = [c.c_void_p]
        api.mpv_wait_event.argtypes = [c.c_void_p, c.c_double]; api.mpv_wait_event.restype = c.c_void_p
        api.mpv_terminate_destroy.argtypes = [c.c_void_p]
        result["clientApi"] = api.mpv_client_api_version()
        for index, sample in enumerate(("Framecode-v2-640x360.mp4", "Framecode-v2-3840x2160-hevc.mkv",
                                         "Precision-SDR10-3840x2160.mkv", "Framecode-v3-3840x2160-av1.mkv")):
            source = ROOT / "build/libmpv-render-spike/samples" / sample
            if index == 0:
                source = folder / "中文 한글 🎬.mp4"
                if not source.exists():
                    shutil.copyfile(ROOT / "build/libmpv-render-spike/samples" / sample, source)
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            handle = api.mpv_create(); assert handle
            try:
                for key, value in (("config", "no"), ("terminal", "no"), ("vo", "null"), ("ao", "null"),
                                   ("hwdec", "d3d11va-copy" if index == 0 else "no"), ("pause", "yes")):
                    assert api.mpv_set_option_string(handle, key.encode(), value.encode()) == 0
                assert api.mpv_initialize(handle) == 0
                command = (c.c_char_p * 4)(b'loadfile', str(source).encode("utf8"), b'replace', None)
                assert api.mpv_command(handle, command) == 0
                width, height = c.c_int64(), c.c_int64()
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    api.mpv_wait_event(handle, .02)
                    if api.mpv_get_property(handle, b'width', 4, c.byref(width)) == 0 and api.mpv_get_property(handle, b'height', 4, c.byref(height)) == 0 and width.value > 0:
                        break
                assert width.value > 0 and height.value > 0
                command = (c.c_char_p * 4)(b'seek', b'1.24', b'absolute+exact', None)
                assert api.mpv_command(handle, command) == 0
                position = c.c_double()
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    api.mpv_wait_event(handle, .02)
                    if api.mpv_get_property(handle, b'time-pos', 5, c.byref(position)) == 0 and abs(position.value-1.24) < .1:
                        break
                assert abs(position.value-1.24) < .1
                pixel = api.mpv_get_property_string(handle, b'video-params/pixelformat'); assert pixel
                pixel_name = c.string_at(pixel).decode("utf8"); api.mpv_free(pixel)
                hardware = api.mpv_get_property_string(handle, b'hwdec-current')
                hardware_name = c.string_at(hardware).decode("utf8") if hardware else ""
                if hardware:
                    api.mpv_free(hardware)
                if index == 0:
                    assert hardware_name == "d3d11va-copy", "Requested hardware decode did not activate"
                result["samples"].append({"sample": sample, "width": width.value, "height": height.value,
                                           "pixelFormat": pixel_name, "hardwareDecode": hardware_name,
                                           "seekStatePosition": position.value, "unicodePath": index == 0})
                assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
                result_file.write_text(json.dumps(result, indent=2) + "\n")
            finally:
                api.mpv_terminate_destroy(handle)
    result["passed"] = True
    result_file.write_text(json.dumps(result, indent=2) + "\n")
    build.update(windowsTestsPassed=True, windowsTestReport="windows-tests.json", electronAccepted=False)
    (folder / "report.json").write_text(json.dumps(build, indent=2) + "\n")
    print(json.dumps({"passed": True, "report": str(result_file)}))
