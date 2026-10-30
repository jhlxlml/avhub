"""Prove compiler/tool execution and build a Windows C++20/D3D11 probe."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    folder = ROOT / "build/native-cross-tools"
    tools = folder / "root/usr"
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"),
           "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu")}
    commands = {
        "gcc": [str(tools / "bin/x86_64-w64-mingw32-gcc-posix"), "--version"],
        "g++": [str(tools / "bin/x86_64-w64-mingw32-g++-posix"), "--version"],
        "ninja": [str(tools / "bin/ninja"), "--version"],
        "meson": ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "--version"],
        "pkgconf": [str(tools / "bin/pkgconf"), "--version"],
        "nasm": [str(tools / "bin/nasm"), "-v"],
    }
    versions = {name: subprocess.run(command, env=env, capture_output=True, text=True,
                                    check=True, timeout=15).stdout.strip()
                for name, command in commands.items()}
    source = folder / "cpp-probe.cpp"
    source.write_text('''#include <d3d11_4.h>
#include <dxgi1_6.h>
#include <span>
#include <cstdio>
int main() {
    int values[] = {1, 2, 3};
    std::span<int> view(values);
    if (view.size() != 3) return 1;
    ID3D11Device *device = nullptr;
    ID3D11DeviceContext *context = nullptr;
    D3D_FEATURE_LEVEL feature;
    HRESULT result = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
        0, nullptr, 0, D3D11_SDK_VERSION, &device, &feature, &context);
    if (FAILED(result)) { std::printf("D3D11 failed: %ld\\n", long(result)); return 2; }
    context->Release();
    device->Release();
    std::printf("{\\"cpp20\\":true,\\"d3d11HardwareDevice\\":true,\\"featureLevel\\":%u}\\n", unsigned(feature));
    return 0;
}
''')
    binary = folder / "cpp-probe.exe"
    resource = folder / "probe.rc"
    resource.write_text('#include <windows.h>\n1 RCDATA {1,2,3}\n')
    resource_object = folder / "probe-resource.o"
    resource_command = [str(folder / "bin/x86_64-w64-mingw32-windres"), str(resource), str(resource_object)]
    subprocess.run(resource_command, env=env, capture_output=True, text=True, check=True, timeout=30)
    command = [commands["g++"][0], "-std=c++20", "-O2", "-static", str(source),
               str(resource_object), "-o", str(binary), "-ld3d11", "-ldxgi"]
    subprocess.run(command, env=env, capture_output=True, text=True, check=True, timeout=60)
    imports = subprocess.run([str(tools / "bin/x86_64-w64-mingw32-objdump"), "-p", str(binary)],
                             capture_output=True, text=True, check=True, timeout=15).stdout
    report = {"versions": versions, "cpp20D3d11ProbeCompiled": True, "windowsResourceCompiled": True,
              "probeSha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
              "imports": [line.split(":", 1)[1].strip() for line in imports.splitlines() if "DLL Name:" in line],
              "windowsProbeExecuted": False, "libmpvBuilt": False, "distributionReady": False}
    (folder / "execution-probe.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(folder / "execution-probe.json"), "compiled": True}))
