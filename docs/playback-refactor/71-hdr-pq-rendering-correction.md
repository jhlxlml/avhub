# Embedded PQ rendering correction — local source, not a published update

2026-11-01; parent HEAD 64ee25bedcea056bd6d13a9e0efb30ec7a3166f0.
Published v0.2.18 assets remain unchanged. This increment does not package,
commit, push, tag or raise the version. Existing user plan/ledger edits retained.

## Reproduction and diagnosis

User-authorized read-only source:
`E:\downloads\The World in HDR in 4K (ULTRA HD).mkv`.
560,421,664 bytes; VP9, 3840x2160, yuv420p10le, limited-range BT.2020 nonconstant
luminance / ST 2084 PQ, 1000-nit mastering metadata. Original SHA256:
`f58b5d0b59d73e0115f9190024c2254d7ef6ad5af6944227024142ec48ea6ad9`.

Actual source Electron reproduction at 5s on both displays captured washed-out
forest/water: `build/hdr-real-media-wsxEgW/report.json` and its display PNGs.
The private F16 frame was declared BT2020/PQ, but implicit external-texture
conversion did not retain the PQ luminance relationship. Existing actual GPU
numerical dossier `hdr-pixels-wRFKiz` already shows a native PQ code near 0.15
(about 1 nit) becoming an sRGB value around 0.425, consistent with treating
the code as a linear value. This is an AVHub integration bug; a declared format
or advancing frame alone had not established correct displayed luminance.

## Source changes

- `electron/src/renderTexture.ts`: for PQ only, transport unchanged numeric F16
  RGB via a private BT709/linear carrier. Send the real output transfer separately.
  Never present that carrier directly or rewrite source colour tags. HLG/SDR
  transport stays unchanged; native host/runtime/hash ownership stays unchanged.
- `electron/src/preload.ts`: explicitly undo carrier encoding, decode ST 2084 to
  absolute luminance, convert BT2020 to BT709 coordinates and encode extended
  sRGB for the existing extended F16 canvas. Reference white is 203 nits; Windows
  linear scRGB /80 numbers are not written as nonlinear sRGB canvas values.
  Keep negative wide-gamut components and HDR values above 1. No tone map,
  gamma/brightness adjustment, 8-bit fallback, source reload or CPU frame copy.
- Actual carrier metadata and payload transfer are separate diagnostic fields.
  PQ validates the carrier before selecting its GPU pipeline; resource receipts
  and texture release remain mandatory. Sandbox/IPC authorization unchanged.
- Numerical harness optionally compiles the **actual production WGSL** against
  native decoded colour/grey fixtures and an independently derived CPU reference.
  Physical harness expects explicit source transfer plus actual carrier fields.
- `render-hdr-real-media.mjs`: isolated source copy, real Electron double-screen
  rendering, precise seek/capture and active playback; original hash/mtime checked.

References: [WebGPU colour-managed input/output](https://www.w3.org/TR/webgpu/),
[Chromium/Dawn PQ reference-white tests](https://chromium.googlesource.com/experimental/external/gob/dawn/dawn/+/43b805ec9edc136b42b55f77ff46f90e73ca2a07/src/dawn/tests/end2end/ExternalTextureTests.cpp),
[MPV target transfer/primaries](https://mpv.io/manual/stable/).

## Actual verification

Source build `f673a418ede9eb59`, version remains 0.2.18 development.
Logs below are under `build/root-session-closeout` unless another path is given.

| Check | Result | Exit / evidence |
| --- | --- | --- |
| frontend/Electron build | PASS | 0; hdr-fix-build.log |
| Node/render/HDR contracts | PASS | 0; 177 checks; hdr-fix-contracts.log |
| production PQ GPU colour probe | PASS numerical | 0; hdr-production-colour.log; build/libmpv-render-spike/hdr-pixels-oEeJMJ/acceptance.json; maximum relative GPU/CPU error 0.0000733918; 9/9 negative gamut components retained |
| production PQ GPU grey probe | PASS numerical | 0; hdr-production-grey.log; hdr-pixels-qamIuw/acceptance.json; maximum relative error 0.0000242660; low-luminance response corrected; superwhite values retained |
| actual user video after correction, both displays | PASS diagnostic capture | 0; hdr-real-media-b2uE73/report.json; forest/water contrast restored in compositor captures; not physical colour certification |
| user VP9 original-file active playback / return / source identity | PASS bounded | 0; hdr-real-final.log; hdr-real-media-uzyW8e/report.json; 15s, position +14.999s, presented serial +897, sourceLoads=1, decoder/output drops 0/0, original SHA/mtime unchanged |
| actual SDR8 control / precise targets / screenshot / Chromium handoff | PASS | 0; hdr-fix-sdr8-flow.log; render-app-flow-kT7Wx5/report.json |
| actual 4K SDR10 controls / original precision | PASS | 0; hdr-fix-sdr10-flow-retry.log; render-app-flow-G46E6A/report.json |
| actual mixed-DPI physical window/seek/screenshot/fullscreen/restore | PASS scoped | 0; hdr-fix-physical-flow.log; physical-app-rtmGLR/report.json; 9 cases; topology/colour state retained in report |

Failures retained: initial TypeScript check rejected the incomplete DOM enum's
linear comparison (fixed with runtime string validation, not a type bypass).
First post-edit source launch had stale build identity because only Electron was
compiled; `hdr-real-media-fx8DN0` retains the startup timeout. Full build restored
matching frontend/backend identity. Initial SDR10 regression incorrectly enabled
the H264-only handoff harness: `render-app-flow-jnrnfg` fails its 10!=8 assertion.
The separate H264 handoff passed; SDR10 was rerun in its supported native flow.
No assertion, format permission or pixel tolerance was weakened.

## Limits / follow-up

This fixes the embedded PQ/HDR10 path for the reported sample and tested numeric
signals. HLG's implicit conversion is not certified or changed by this fix;
Dolby Vision/dynamic metadata and physical peak-luminance mapping also remain
unverified. SDR screenshots can clip HDR highlights and cannot establish what
the physical HDR monitor emits or whether PotPlayer has identical tone-mapping
settings. Do not add a video whitelist or silently tone-map to SDR to match a
screenshot. No new release prepared; current downloaded v0.2.18 does not contain
this source fix. No GitHub Actions monitoring performed.

Subsequent HLG work is recorded separately in
[72](72-hdr-hlg-and-regression-validation.md): it supersedes the statement that
HLG production conversion is unchanged, without retroactively extending this
earlier PQ build's test results. Physical colour certification remains unclaimed.
