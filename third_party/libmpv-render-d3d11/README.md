# Isolated M2 D3D11 Render API candidate

Not installed in AVHub's production runtime; not approved for redistribution.

- mpv source: `baa3e11d42cb7978da634a8a6a3a55fe074d01be`.
- D3D11 API addition: `4255130de410e0cbdab694b951085409d466b704` (2026-10-15).
- Binary: zhongfly/mpv-winbuild `2026-10-25-baa3e11d42`, generic Windows x64 (not x64-v3).
- Exact archive/DLL/header hashes: `ci/libmpv-d3d11-candidate.json`.
- Archive SHA-256: `eac3f092757b3c741d13322ea9884de23f10f09abe16bfe191f04da5680f57f1`.
- DLL SHA-256: `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`.
- Fixed build evidence: <https://github.com/zhongfly/mpv-winbuild/actions/runs/40191236015>.

The release's six-file dev archive declares the D3D11 API in `render.h` but omits
the installation of `render_d3d11.h`. This directory supplies that header from
the **exact matching source commit**, with its original permissive notice. Its
hash is verified separately; it is not claimed to be present in the archive.
`LICENSE.GPL` and `Copyright` are also from that commit. The binary is a GPL
build: these files do not complete the corresponding source/build/dependency
notice obligations. `distributionReady` therefore remains false. Production
packaging/release integration belongs to M5 after M2 and M3 acceptance.

Reproduce input verification:

```powershell
python scripts/prepare-libmpv-render.py --candidate d3d11 --offline --verify-only
```

Remove `--offline --verify-only` to fetch the pinned archive on a clean machine.
This does not modify `bin/mpv`, the production package manifest, or user media.
