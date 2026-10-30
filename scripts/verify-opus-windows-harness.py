"""Execute generated official Windows tests and a real DLL API smoke test."""
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    if os.name != "nt":
        raise SystemExit("Run with Windows x64 Python, not Wine/WSL")
    latest = json.loads((ROOT / "build/opus-windows-cross-latest.json").read_text())
    name = Path(latest["folder"]).name
    if not re.fullmatch(r"opus-windows-cross-[a-z0-9_]+", name):
        raise ValueError("Not an owned cross-build folder")
    folder = ROOT / "build" / name
    build = json.loads((folder / "report.json").read_text())
    if not build["buildPassed"] or build["currentRuntimeReplaced"]:
        raise ValueError("Expected a completed isolated compiler harness")
    for binary in build["binaries"]:
        if hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() != binary["sha256"]:
            raise ValueError("Generated binary changed")
    report = {"kind": "actual-windows-opus-library-tests-not-electron-acceptance",
              "sourceRevision": build["sourceRevision"], "dllApiPassed": False,
              "officialTests": [], "passed": False, "currentRuntimeReplaced": False,
              "distributionReady": False}
    result_file = folder / "windows-tests.json"
    result_file.write_text(json.dumps(report, indent=2) + "\n")
    dll = ctypes.CDLL(str(folder / "build/libopus.dll"))
    dll.opus_get_version_string.restype = ctypes.c_char_p
    dll.opus_encoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    dll.opus_encoder_create.restype = ctypes.c_void_p
    dll.opus_decoder_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    dll.opus_decoder_create.restype = ctypes.c_void_p
    dll.opus_encode_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int,
                                     ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int]
    dll.opus_decode_float.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int,
                                     ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_int]
    dll.opus_encoder_destroy.argtypes = [ctypes.c_void_p]
    dll.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
    error = ctypes.c_int()
    encoder = dll.opus_encoder_create(48000, 2, 2049, ctypes.byref(error))
    assert encoder and error.value == 0
    decoder = dll.opus_decoder_create(48000, 2, ctypes.byref(error))
    assert decoder and error.value == 0
    pcm = (ctypes.c_float * 1920)(*[.3 * math.sin(2 * math.pi * 440 * (i // 2) / 48000) for i in range(1920)])
    packet = (ctypes.c_ubyte * 4000)()
    size = dll.opus_encode_float(encoder, pcm, 960, packet, len(packet))
    assert 0 < size <= len(packet)
    decoded = (ctypes.c_float * 1920)()
    frames = dll.opus_decode_float(decoder, packet, size, decoded, 960, 0)
    assert frames == 960 and all(math.isfinite(x) for x in decoded)
    rms = math.sqrt(sum(x*x for x in decoded) / len(decoded))
    assert .01 < rms < .5
    dll.opus_encoder_destroy(encoder)
    dll.opus_decoder_destroy(decoder)
    report.update(dllApiPassed=True, version=dll.opus_get_version_string().decode("utf8"),
                  decodedSamplesPerChannel=frames, decodedRms=rms,
                  dllSha256=hashlib.sha256((folder / "build/libopus.dll").read_bytes()).hexdigest())
    for name in ("decode", "padding", "api", "encode", "extensions"):
        executable = folder / "static-tests" / ("test_opus_" + name + ".exe")
        assert executable.is_file(), "Missing official static-build test: " + name
        start = time.monotonic()
        result = subprocess.run([str(executable)], cwd=executable.parent,
                                capture_output=True, timeout=120)
        (folder / ("windows-test-" + name + ".log")).write_bytes(result.stdout + result.stderr)
        report["officialTests"].append({"name": name, "exitCode": result.returncode,
                                         "seconds": time.monotonic()-start})
        result_file.write_text(json.dumps(report, indent=2) + "\n")
        assert result.returncode == 0, "Official Windows test failed: " + name
        print(name + " passed", flush=True)
    report["passed"] = True
    result_file.write_text(json.dumps(report, indent=2) + "\n")
    build.update(windowsTestsPassed=True, windowsTestReport="windows-tests.json", officialWindowsTestsPassed=5)
    (folder / "report.json").write_text(json.dumps(build, indent=2) + "\n")
    print(json.dumps({"report": str(result_file), "passed": True}))
