"""Exercise real Windows GLSL -> SPIR-V -> HLSL; not a rendered-frame test."""
import argparse
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import struct
from native_source_replay import owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--render-deps", type=Path)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    if bool(args.build_dir) != bool(args.render_deps):
        raise ValueError("Select shader and render dependency prefixes together")
    shader = owned_build(args.build_dir, "shaderc-windows-cross-latest.json", r"shaderc-(?:windows-cross|source-replay)-[a-z0-9_]+")
    deps = owned_build(args.render_deps, "render-deps-cross-latest.json", r"render-deps-(?:cross|replay)-[a-z0-9_]+")
    shader_build = json.loads((shader / "report.json").read_text())
    deps_build = json.loads((deps / "report.json").read_text())
    if "sourceMaterialsReplay" in shader_build:
        assert shader_build["sourceMaterialsReplay"]["inventorySha256"] == deps_build["sourceMaterialsReplay"]["inventorySha256"]
    for folder in (shader, deps):
        report = json.loads((folder / "report.json").read_text())
        assert report["buildPassed"]
        for binary in report["binaries"]:
            assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    with os.add_dll_directory(str(shader / "install/bin")), os.add_dll_directory(str(deps / "install/bin")):
        dll = c.CDLL(str(shader / "install/bin/libshaderc_shared.dll"))
        dll.shaderc_compiler_initialize.restype = c.c_void_p
        dll.shaderc_compile_into_spv.argtypes = [c.c_void_p, c.c_char_p, c.c_size_t, c.c_int, c.c_char_p, c.c_char_p, c.c_void_p]
        dll.shaderc_compile_into_spv.restype = c.c_void_p
        dll.shaderc_result_get_compilation_status.argtypes = [c.c_void_p]
        dll.shaderc_result_get_error_message.argtypes = [c.c_void_p]; dll.shaderc_result_get_error_message.restype = c.c_char_p
        dll.shaderc_result_get_length.argtypes = [c.c_void_p]; dll.shaderc_result_get_length.restype = c.c_size_t
        dll.shaderc_result_get_bytes.argtypes = [c.c_void_p]; dll.shaderc_result_get_bytes.restype = c.c_void_p
        dll.shaderc_result_release.argtypes = [c.c_void_p]; dll.shaderc_compiler_release.argtypes = [c.c_void_p]
        compiler = dll.shaderc_compiler_initialize(); assert compiler
        source = b'#version 450\nvoid main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }\n'
        result = dll.shaderc_compile_into_spv(compiler, source, len(source), 0, b'owned.vert', b'main', None)
        assert result
        assert dll.shaderc_result_get_compilation_status(result) == 0, dll.shaderc_result_get_error_message(result)
        spirv = c.string_at(dll.shaderc_result_get_bytes(result), dll.shaderc_result_get_length(result))
        assert len(spirv) > 20 and struct.unpack('<I', spirv[:4])[0] == 0x07230203
        dll.shaderc_result_release(result); dll.shaderc_compiler_release(compiler)
        cross = c.CDLL(str(deps / "install/bin/libspirv-cross-c-shared.dll"))
        cross.spvc_context_create.argtypes = [c.POINTER(c.c_void_p)]
        cross.spvc_context_parse_spirv.argtypes = [c.c_void_p, c.POINTER(c.c_uint32), c.c_size_t, c.POINTER(c.c_void_p)]
        cross.spvc_context_create_compiler.argtypes = [c.c_void_p, c.c_int, c.c_void_p, c.c_int, c.POINTER(c.c_void_p)]
        cross.spvc_compiler_create_compiler_options.argtypes = [c.c_void_p, c.POINTER(c.c_void_p)]
        cross.spvc_compiler_options_set_uint.argtypes = [c.c_void_p, c.c_uint, c.c_uint]
        cross.spvc_compiler_install_compiler_options.argtypes = [c.c_void_p, c.c_void_p]
        cross.spvc_compiler_compile.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
        cross.spvc_context_destroy.argtypes = [c.c_void_p]
        context, ir, translator, options = c.c_void_p(), c.c_void_p(), c.c_void_p(), c.c_void_p()
        words = struct.unpack('<' + 'I' * (len(spirv)//4), spirv)
        assert cross.spvc_context_create(c.byref(context)) == 0
        assert cross.spvc_context_parse_spirv(context, (c.c_uint32 * len(words))(*words), len(words), c.byref(ir)) == 0
        assert cross.spvc_context_create_compiler(context, 2, ir, 1, c.byref(translator)) == 0
        assert cross.spvc_compiler_create_compiler_options(translator, c.byref(options)) == 0
        assert cross.spvc_compiler_options_set_uint(options, 13 | 0x4000000, 50) == 0
        assert cross.spvc_compiler_install_compiler_options(translator, options) == 0
        hlsl = c.c_char_p(); assert cross.spvc_compiler_compile(translator, c.byref(hlsl)) == 0
        text = hlsl.value.decode("utf8"); assert 'SV_Position' in text and 'main' in text
        cross.spvc_context_destroy(context)
    (shader / "owned.vert").write_bytes(source)
    (shader / "owned.spv").write_bytes(spirv)
    (shader / "owned.hlsl").write_text(text)
    result = {"kind": "actual-windows-glsl-spirv-hlsl-not-render-acceptance", "passed": True,
              "spirvBytes": len(spirv), "spirvSha256": hashlib.sha256(spirv).hexdigest(), "hlslShaderModel": 50}
    (shader / "windows-tests.json").write_text(json.dumps(result, indent=2) + "\n")
    report = json.loads((shader / "report.json").read_text()); report.update(windowsExecutionPassed=True, windowsTestReport="windows-tests.json")
    (shader / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": True, "report": str(shader / "windows-tests.json")}))
