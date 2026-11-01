# HDR HLG follow-up and current-source regression

Date: 2026-11-01 (Asia/Shanghai). Baseline HEAD:
`64ee25bedcea056bd6d13a9e0efb30ec7a3166f0`, with the retained uncommitted PQ
correction in [71](71-hdr-pq-rendering-correction.md). New production build:
`953412933d9eca1d`; version remains 0.2.18 development. This is **not** the
published v0.2.18 payload. No packaging, commit, push, tag, upload or CI polling.

## Finding and correction

The generated HLG grey signal reproduced the floating HDR external-texture
problem: native decoded codes were accurate (maximum error 0.0004838283), but
implicit GPU conversion produced inconsistent inferred reference whites, spread
52.438. This failed run remains `hdr-pixels-7xfymM/acceptance.json`, exit 1.
Its log is `build/root-session-closeout/hlg-implicit-baseline.log`.

The production numeric carrier and explicit GPU conversion now cover both PQ
and HLG. HLG uses the BT.2100 inverse OETF and luminance-coupled OOTF at the
nominal 1000-nit/gamma-1.2 reference, then the existing extended-sRGB F16 canvas
with a 203-nit reference white. It does not apply per-channel gamma in place of
the luminance OOTF. Shared conversion preserves negative wide-gamut components
and values above SDR white. SDR's fragment remains unchanged. No video/audio
re-encoding, source metadata rewriting, 8-bit fallback or HDR-to-SDR tone map.

The numerical test compiles the actual production WGSL; its CPU reference is
derived separately. Exact fixture allowlists constrain only isolated numerical
tests, not application playback. Production native C# binaries, runtime hashes,
sandbox and import/release receipts are unchanged. `render-api/RenderHost.cs`
is the numerical test helper, not the production native host.

References: [ITU-R BT.2100-2, HLG equations](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2100-2-201807-S%21%21PDF-E.pdf),
[Khronos Data Format 1.4](https://registry.khronos.org/DataFormat/specs/1.4/dataformat.1.4.html).

## Numerical and physical-window evidence

All evidence directories below are under `build/`. Logs and exit-code JSONs are
under `root-session-closeout/`. No thresholds or assertions were weakened.

| Check | Status | Exit / evidence |
| --- | --- | --- |
| frontend + Electron build | PASS | 0; hdr-next-build logs; build 953412933d9eca1d |
| Node/render/HDR contracts | PASS | 0; hdr-next-final-contracts.log; 179 tests, no failures/skips |
| independent HDR math | PASS | 0; hdr-next-math.log; 11 tests including nominal HLG luminance/OOTF |
| PQ production GPU grey | PASS numerical | 0; libmpv-render-spike/hdr-pixels-jcX4Cz/acceptance.json; max relative error 0.0000242660 |
| PQ production GPU colour | PASS numerical | 0; hdr-pixels-TWnt1q; error 0.0000733918; 9/9 negative components preserved |
| HLG production GPU grey | PASS numerical | 0; hdr-pixels-TYfYdp; error 0.0000014520 |
| HLG production GPU colour | PASS numerical | 0; hdr-pixels-9tfrn5; error 0.0000705231; 9/9 negative components preserved |
| actual Electron dual-display 4K PQ/HLG | PASS scoped | 0; physical-app-Jhmq9p/report.json; 6 cases, 120 actual compositor frame-code seek checks, full screen and restore, original-size 16-bit PNG capture |
| actual SDR8 controls / Chromium handoff | PASS | 0; hdr-next-sdr8-handoff.log; render-app-flow-O71EXA/report.json |
| actual 4K SDR10 controls / original precision | PASS | 0; hdr-next-sdr10.log; render-app-flow-fXoUbi/report.json |

Physical topology was queried from Windows, without modifying display settings:
PHL 328E8F SDR at 125%; LS27D80xU at 175%, HDR supported and user-enabled,
10 bits per colour, activeColorMode=2. Electron's colourDepth=24 alone was not
used to infer that HDR was off. Six cases move each generated 4K fixture
SDR → HDR → SDR. Screenshot dimensions are 3840×2160 and bit depth is 16;
measured capture completion is 482–504 ms. These checks establish working
application/display transitions, not physical luminance or gamut accuracy.

HLG generated code-value fixtures are not mastered HDR footage. The continuous
HLG fixture derives only from the application-owned synthetic 960s/4K25 frame
chart, with stream-copy and HEVC/container HLG declarations. The first decoded
YUV frame is byte-identical to that generated input; no real video is retagged.
Receipt: `hdr-hlg-long-dm5_hoh7/fixture.json`; SHA256:
`49e1fd73233d2fba620c7a6fa01ac27a3e8aefb5e8a17e929baca3e0b3093b83`.

## Current-source long regression

Real VP9/PQ: **PASS**, exit 0, `root-session-closeout/hdr-next-real-long.log`
and `hdr-real-media-KlruEG/report.json`, build 953412933d9eca1d. Requested 600s,
actual wall 600.004s, accumulated forward media advancement 592.090s excluding
nine planned seek resets. Presented-serial advancement 35,702; sourceLoads=1;
decoder/output drops 0/0. The 154.581s real video was deliberately sought back
to 5s once per minute so that playback did not simply end. This is repeated
real-video playback with seeking, not 600s of unique footage or a seek-speed
benchmark. UI polling completion of those seeks was 878–909ms; it is not
decoder-only seek latency.

Original SHA256 and mtime are unchanged. Actual close log confirms helper dead,
source lease released, 35,723 texture imports/releases/GPU completions balanced,
one native lease opened/closed and timer requests/releases 2/2. Both physical
display compositor captures are retained; they do not certify physical HDR.

HLG generated continuous 4K25: **PASS at the existing convergence policy**,
exit 0, `root-session-closeout/hdr-next-hlg-long.log` and
`render-app-soak-Qh27rn/report.json`, same source build. Warmup is separate;
measured continuous interval is 600.051s, 274 real compositor frame-code samples,
maximum clock/pixel error 4 frames (unchanged limit 10), pixel/wall progression
ratio 0.999975 (unchanged interval 0.99–1.01). Decoder/output drops 0/0;
15,792 imports/releases/GPU completions balance at close, helper dead, source
lease released, timer requests/releases 2/2. The isolated test media copy was
removed only after verified unchanged identity and complete reader shutdown;
the generated source and its receipt remain.

**Raw resource range is still FALSE**, not waived or relabelled PASS: late GPU
active range 69,206,016 bytes and handle range 17 exceed the original 64MiB/16
raw bounds. Separately, the existing baseline-relative convergence policy
passes: GPU peak/settled positive growth 0/0; handle peak growth 9, settled
growth 0, idle range 0; native private peak growth 2,195,456 bytes and settled
growth 1,478,656 bytes. No policy, drop limit, sampling requirement or tolerance
was relaxed. These observations do not establish an unbounded leak, nor prove
unlimited stability. Earlier v0.2.18 soak results are comparison only and do not
certify this shader change.

## Remaining scope

- Real VP9/PQ sample is available and validated read-only through an isolated
  copy. Its original SHA256 is
  `f58b5d0b59d73e0115f9190024c2254d7ef6ad5af6944227024142ec48ea6ad9`.
- Real HEVC HDR, AV1 HDR and HLG footage: **SKIP**, no other indexed HDR samples;
  user explicitly confirmed none available and requested retaining these gaps.
  Generated HEVC charts do not fill those real-footage gaps.
- Physical luminance/gamut/peak mapping: **BLOCKED** for colourimetric
  certification, no meter/calibration evidence. Screenshots and GPU readback
  cannot certify emitted monitor luminance or matching PotPlayer settings.
- HLG is tested against a nominal 1000-nit reference, not certified adaptive
  behaviour for every display/ambient condition. Dolby Vision/dynamic metadata
  remain unverified. No new video-admission restrictions are added.
- External-machine follow-up remains deferred as requested. No claim that old
  physical-machine/package acceptance covers this new source shader.
