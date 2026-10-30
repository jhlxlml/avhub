"""Exercise actual built Windows library APIs; no renderer/display claim."""
import argparse
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import re
from native_source_replay import owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    folder = owned_build(args.build_dir, "render-deps-cross-latest.json", r"render-deps-(?:cross|replay)-[a-z0-9_]+")
    report = json.loads((folder / "report.json").read_text())
    assert report["buildPassed"]
    for binary in report["binaries"]:
        assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    files = list((folder / "install/bin").glob("*.dll"))
    result = {"kind": "real-windows-library-apis-not-libplacebo-or-electron-acceptance", "passed": False}
    (folder / "windows-tests.json").write_text(json.dumps(result, indent=2) + "\n")
    with os.add_dll_directory(str(folder / "install/bin")):
        cms = c.CDLL(str(next(p for p in files if "lcms2" in p.name and "threaded" not in p.name and "fast" not in p.name)))
        cms.cmsCreate_sRGBProfile.restype = c.c_void_p
        cms.cmsCreateTransform.argtypes = [c.c_void_p, c.c_uint, c.c_void_p, c.c_uint, c.c_uint, c.c_uint]
        cms.cmsCreateTransform.restype = c.c_void_p
        cms.cmsDoTransform.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p, c.c_uint]
        cms.cmsDeleteTransform.argtypes = [c.c_void_p]
        cms.cmsCloseProfile.argtypes = [c.c_void_p]
        profile = cms.cmsCreate_sRGBProfile()
        rgb_float = (1 << 22) | (4 << 16) | (3 << 3) | 4
        transform = cms.cmsCreateTransform(profile, rgb_float, profile, rgb_float, 1, 0x100)
        assert profile and transform
        source, target = (c.c_float * 3)(.13, .47, .91), (c.c_float * 3)()
        cms.cmsDoTransform(transform, source, target, 1)
        assert max(abs(a-b) for a, b in zip(source, target)) < .0001
        cms.cmsDeleteTransform(transform); cms.cmsCloseProfile(profile)
        result["lcmsFloatTransformPassed"] = True
        xx = c.CDLL(str(next(p for p in files if "xxhash" in p.name.lower())))
        xx.XXH64.argtypes = [c.c_void_p, c.c_size_t, c.c_uint64]
        xx.XXH64.restype = c.c_uint64
        assert xx.XXH64(None, 0, 0) == 0xef46db3751d8e999
        result["xxhashKnownVectorPassed"] = True
        spvc = c.CDLL(str(next(p for p in files if "spirv-cross-c-shared" in p.name)))
        spvc.spvc_context_create.argtypes = [c.POINTER(c.c_void_p)]
        spvc.spvc_context_parse_spirv.argtypes = [c.c_void_p, c.POINTER(c.c_uint32), c.c_size_t, c.POINTER(c.c_void_p)]
        spvc.spvc_context_create_compiler.argtypes = [c.c_void_p, c.c_int, c.c_void_p, c.c_int, c.POINTER(c.c_void_p)]
        spvc.spvc_compiler_compile.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
        spvc.spvc_context_destroy.argtypes = [c.c_void_p]
        # Owned minimal vertex module: actual SPIR-V parsing and HLSL emission,
        # not a GPU draw or shader correctness/pixel-quality acceptance test.
        words = [0x07230203,0x00010000,0,5,0,0x00020011,1,0x0003000e,0,1,
                 0x0005000f,0,1,0x6e69616d,0,0x00020013,2,0x00030021,3,2,
                 0x00050036,2,1,0,3,0x000200f8,4,0x000100fd,0x00010038]
        context, ir, compiler = c.c_void_p(), c.c_void_p(), c.c_void_p()
        assert spvc.spvc_context_create(c.byref(context)) == 0
        assert spvc.spvc_context_parse_spirv(context, (c.c_uint32 * len(words))(*words), len(words), c.byref(ir)) == 0
        assert spvc.spvc_context_create_compiler(context, 2, ir, 1, c.byref(compiler)) == 0
        hlsl = c.c_char_p()
        assert spvc.spvc_compiler_compile(compiler, c.byref(hlsl)) == 0
        assert "main" in hlsl.value.decode("utf8")
        spvc.spvc_context_destroy(context)
        result["spirvToHlslPassed"] = True
    result["passed"] = True
    (folder / "windows-tests.json").write_text(json.dumps(result, indent=2) + "\n")
    report.update(windowsExecutionPassed=True, windowsTestReport="windows-tests.json")
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": True, "report": str(folder / "windows-tests.json")}))
