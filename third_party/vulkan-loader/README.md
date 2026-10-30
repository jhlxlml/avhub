# Vulkan loader preparation input

This directory contains the unmodified source license and the runtime ZIP
license, not approval of the entire libmpv distribution. Binary files stay in
the application-owned build cache.

- Repository: <https://github.com/KhronosGroup/Vulkan-Loader>
- Source tag: `vulkan-sdk-1.4.363.0`
- Resolved commit: `fa218055ff4948b159f31d43f800c808a13d51df`
- License source: <https://github.com/KhronosGroup/Vulkan-Loader/blob/fa218055ff4948b159f31d43f800c808a13d51df/LICENSE.txt>
- License SHA-256: `43c0a37e6a0fa7ff3c843b3ec5a4fac84b712558ddac103fbd4c1649662a9ece`
- Official component ZIP metadata: <https://vulkan.lunarg.com/sdk/files.json>
- Version-specific download: <https://sdk.lunarg.com/sdk/download/1.4.363.0/windows/VulkanRT-X64-1.4.363.0-Components.zip>
- Expected archive bytes: `18211191`
- Expected SHA-256: `a25a927aa8b9f0371048f1861cf88ac3b9bc9b1fb332c42d897c8ab32695769a`

The fixed metadata is in `ci/vulkan-runtime.json`. The user supplied the official
1.4.363.0 ZIP after the earlier 1.4.350.0 download was blocked. Its full SHA-256
and length match the official catalog. The x64 DLL SHA-256 is
`e1fcfc9489beefa6a6d9d11d6c7517f6a2b7f16e0d3fb8f4103bee0210f314a3`.
`VulkanRT-License.txt` is copied byte-for-byte from that verified ZIP; SHA-256
`404deb98dabf3e54bf9070d59676b31d69a3da2f9f6e56bdf09ad315c04c718c`.
The source tag identifies matching SDK source materials, not an independently
reproduced binary build. No system DLL was copied or changed.

Once the exact official ZIP is present in `build/vulkan-runtime-input/`, run
`python scripts/prepare-vulkan-runtime.py --offline`. This verifies the whole
archive before selecting exactly one AMD64 PE32+ loader. It only publishes
`vulkan-1.dll`, both verified license files and a record into an owned cache;
it never runs the installer or writes into Windows directories. A corrupt or
different existing input is preserved and rejected.

`node scripts/stage-render-runtime.mjs` then requires the real prepared loader
and verified current host/libmpv/FFI inputs before creating a fresh local layout
candidate. This is not an Electron package or clean-machine acceptance. The
production backend remains disabled until M5 distribution requirements pass.
