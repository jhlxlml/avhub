# 0.2.19 local candidate: release held

2026-11-01, user authorized the proposed verify/package-before-tag sequence.
HEAD remains 64ee25bedcea056bd6d13a9e0efb30ec7a3166f0. Existing HDR changes,
untracked user planning document and archive are preserved. Version 0.2.19 is
prepared in package/lock/fallback metadata and docs/RELEASE-0.2.19.md; retain
this version on retries. No commit, push, tag, Release upload or CI polling.

Build: `2d3d8934540d8439`, timestamp `2026-11-01T11:04:51.356Z`.
Candidate: `build/release-0219-acceptance-pktyqetd`.
Final-named local assets: `build/release-0219-final-_c4nem5p`.
Final EXE/ASAR/runtime bytes match the actual tested candidate, enforced by
electron/release-evidence.cjs; ASAR SHA256:
`8ca6c46f897e189c8e3b1dd0d0c7b8ba821aa02fdcf2d2ff117af4090d901299`.

## Executed checks

Logs/exit JSONs: build/root-session-closeout/release-0219-*.

| Check | Result | Exit / evidence |
| --- | --- | --- |
| npm ci / explicit Electron install | PASS | 0 / 0; npm-ci and electron-install logs |
| moderate npm audit | PASS | 0; zero vulnerabilities; no audit bypass |
| frontend / Electron build | PASS | 0 / 0; build / electron-build logs |
| Node/render/HDR contracts | PASS | 0; 179 checks |
| backend | PASS with two skips | 0; 787 tests run; backend.log retains skip reasons |
| frozen source/frontend/Electron/backend replay | PASS | 0; application-build-replay-DLObIF; source-replay / backend-replay logs |
| actual independent MPV | PASS | 0; native-independent-Pq3m2U/acceptance.json |
| actual packaged mode coexistence | PASS | 0; mpv-window-coexistence-SLuXNd/report.json |
| actual embedded controls / pixel targets / Chromium handoff | PASS | 0; render-app-flow-ZjblYu/report.json |
| actual packaged physical HDR / mixed-DPI test | FAIL prerequisite | 1; physical-app-GCZucd/report.json; only one display exposed |
| corresponding source / license / runtime inputs | PASS scoped | 0; source-delivery / release-inputs logs; all 1,218 source members verified |
| final EXE / folder ZIP build and byte binding | PASS | 0; final-build-exit.json; portable-build / folder-build logs |
| actual single EXE migration/start/restart/exit | PASS | 0; portable-release-test-SdzUvy; synthetic old library and one playlist |
| actual extracted folder ZIP migration/start/restart/exit | PASS | 0; folder-release-test-PkN3kG; same scoped fixtures |

Portable checks used CI=true only to select the existing, explicitly labelled
mock GitHub update response; actual Electron/backend/filesystem migration and
exit were not replaced. They are not physical colour or clean-machine tests.
Three local library-ready samples: single EXE 12.089/11.836/11.511s; extracted
folder ZIP 1.972/1.162/0.837s. No OS cache flush/cold-boot performance claim.

## HDR output-drop failures and controlled follow-up

The real VP9/PQ source was read-only, played from isolated copies through the
actual packaged application. The local adapter harness copies the existing
render-hdr-real-media.mjs into build/, changes only its executable launch and
actual subject assertion to packaged-desktop, and retains zero-drop assertions.
The optional timing observer wraps actual method calls without skipping work or
inventing frame completion. These scripts and their report subjects are retained.

| 45-second run | Version | Result | Decoder / output drops | Evidence |
| --- | --- | --- | --- | --- |
| first packaged run, concurrent portable compression | 0.2.19 | FAIL / 1 | 0 / 1 | hdr-real-media-zmE5Sp |
| quiet final-EXE repeat, no parallel packaging | 0.2.19 | FAIL / 1 | 0 / 11 | hdr-real-media-xlYGJb |
| same-session published-package control | 0.2.18 | PASS / 0 | 0 / 0 | hdr-real-media-dLXols |
| bounded timing-observer diagnostic | 0.2.19 | PASS scoped / 0 | 0 / 0 | hdr-real-media-h8N34h |
| matching timing-observer control | 0.2.18 | PASS scoped / 0 | 0 / 0 | hdr-real-media-YHbHBc |

All measured runs have sourceLoads=1. Timing comparison measured texture
present/release mean 4.089ms / p95 5.2ms for 0.2.19, versus mean 4.439ms /
p95 6.5ms for 0.2.18; no >=40ms observer event in either diagnostic. This does
not explain or invalidate the two uninstrumented failures. No tolerance, output
quality, frame counter or loading UI was changed to obtain a pass. A persistent
GPU conversion slowdown is not established, but an intermittent regression is
not excluded. A 45s diagnostic pass does not certify long-term performance.

Current session is RDP, exposing one 1536×864/125% display. Windows reports the
NVIDIA RTX 4090 and Microsoft Remote Display Adapter; Chromium reports sandboxed
ANGLE D3D11 on RTX 4090. Do not assume software rendering or blame RDP without
matched physical-console evidence. Previous HDR/mixed-DPI source checks in 72
have different display topology and do not certify this packaged run.

User explicitly deferred reconnecting the HDR second screen. Retain this as an
uncompleted packaged physical test, separately from the actual exit-1 report.
No repeated reruns until pass, no old results substituted, and no speculative
timer/prefetch changes in this release preparation.

## Decision

**ReleaseReady=false.** Local EXE/ZIP/source assets exist, but the unexplained
real-video output-drop failures prevent declaring full product acceptance.
Do not push a stable tag or upload this candidate as a verified release yet.
Next compare longer uninstrumented old/new runs on a physical interactive
desktop, then collect bounded pipeline timings around an actual failing window
before changing scheduling/rendering code. Keep double-display HDR and missing
real HEVC/AV1/HLG samples explicit; those sample gaps are not playback gates.

This addendum and LOCAL-ACCEPTANCE.json are later sidecar evidence, not claimed
to be included in the already hashed source ZIP. The source bundle includes the
frozen tested product source, runtime recipes/materials, and prior-stage ledgers.
