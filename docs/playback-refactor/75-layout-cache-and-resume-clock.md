# Layout cache, resume state and clock reconciliation

2026-11-01; continues [74](74-embedded-frame-cadence-investigation.md).
Version stays 0.2.19, no commit/push/tag/upload or CI polling. Older 2d3d and
ed971 local packages remain older evidence; none is published as 0.2.19.

## Confirmed allocation regression

The earlier HDR preload change replaced the original layout cache with a
per-frame pipeline.getBindGroupLayout(0). Chromium returns a new GC-managed
wrapper per call; see its
[implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webgpu/gpu_render_pipeline.cc).
The actual production isolated-world API was observed with a wrapper that
still executes the original method; no frames, callbacks or GPU work skipped.

- Before, actual ed971 package: D8h3f0, 30s, 1,844 layout calls, exit 0.
- After per-pipeline cache: Z4C7Sc, 30s, exactly 3 calls (SDR/PQ/HLG), but
  outputDrops=1 early in playback; **FAIL**, exit 1. Allocation reduction is
  proven, but it is not proof that all output drops are solved.

The immutable layouts are now cached separately for the three pipelines.
Production WGSL text was compared byte-for-byte with the prior source snapshot
and is unchanged by this cache change. Original F16/HDR processing, external
texture lifetimes and receipt/release protocol are unchanged.

## Confirmed stale state / clock ordering

Actual before-run 5qd0eW captured native pause=false while the published clock
was inactive after user resume. The play command previously published stale
paused props and waited for a later periodic snapshot. Resume now primes the
owned clock before native play, reads real native state and then publishes it;
pause also reads the actual result. First-frame and seek intent deferral remain.
The shared private resume method is reused across explicit/initial/seek resume.

Three command-order contracts were added. Two fail on the old compiled
implementation; all pass after the first change. These are fake-resource
contracts, not hardware acceptance. Initial source build 48ea84b4a2a8185d passed
182 contracts, but real 300s run fmLsrt **FAILed**, exit 1: output sample maximum
2, final counter 1, decoder drops 0. It also exposed a real interleaving:
afterResume.clock={active:false,requests:2,releases:2}; a parallel pump had
released the clock using the old paused props while play was in flight.

The helper now reconciles the clock again after real native readback using
current intent, visibility/minimize and EOF state. A fourth contract reproduces
the stale-pump release; it fails before reconciliation and passes afterwards.
playbackClock itself still deduplicates native begin/end calls; no new timer,
OS policy override or optimistic pause value. Current build
2796aa86cc7377a5 (2026-11-01T12:52:12.919Z) builds and passes 183 contracts.

## Stronger diagnostics / retained failures

The native drop counter resets on seek in this runtime. The old harness's
final-only check could therefore miss earlier observed failures (5c4D9v was
corrected in 74). The harness now retains bounded pause/intent/clock/drop
transitions, samples, resume boundaries and measurement-window observed maxima;
all observed maxima must still be zero. No loading-UI suppression or relaxed
drop assertion. Original initial-load transitions are retained separately from
the playback measurement window, not silently called steady-state zero.

Timing diagnostics can now select methods-only observation, keeping the actual
method wrappers but disabling the extra event-loop monitor interval. This is
explicitly reported as eventLoop=null; it does not request a higher test clock
resolution or replace playback operations.

Current 2796 five-minute methods-only real run: PASS, exit 0;
hdr-real-media-29Qf6Y/report.json, 300.027s, four seek resets, 17,857 presented
serial advance, sourceLoads=1. Both final deltas and measurement-window observed
decoder/output maxima are zero. afterResume.clock is active, requests=2 /
releases=1; the paused baseline was inactive, requests/releases=1/1. Original
identity is unchanged. The methods-only report has eventLoop=null, no test
high-resolution-clock override. It retains ~45ms host snapshot/pump events near
planned seek handling; these did not produce observed playback-window drops.

Actual current-source SDR8/Chromium handoff CLGwWF, 4K SDR10 QBdult and
minimize/restore uKCrK1 pass with exit 0. Generated HLG verification qBvULb
also completed with exit 0; actual pixels, counters and resource policy are
retained in its report. No real HLG footage or physical colour certification.
Final fresh package,
physical HDR/mixed-DPI follow-up and missing real HEVC/AV1/HLG samples are not
claimed passed by this source work. Version remains prepared for a future
qualified retry; previous failed runs and their exact exits remain retained.

## Final-source packaged acceptance

Fresh frozen frontend/Electron/backend replay application-build-replay-AF4GI3
passes with matching 2796 identity. Ordinary candidate:
build/release-0219-clock-acceptance-ohqc7r5q. Five actual packaged checks PASS,
exit 0: independent zCKbjm; coexistence WGdUm9; native controls/Chromium handoff
gAFIrh; real VP9/PQ Y1MtXS (120.015s, 7,163 presented-serial advance, one seek,
sourceLoads=1, final and all observed playback decoder/output maxima 0/0,
afterResume.clock active); generated HLG YsuyoV (actual compositor pixels and
original-size precision, counter/resource/cleanup policies retained in report).
These are the current build's results, not the older candidates' reports.

Final EXE/ZIP/source sealing and actual portable upgrade/restart/exit checks
remain pending. Physical HDR second-screen / external tests remain deferred.
No stable tag or Release yet. Final packaging must match these exact EXE/ASAR/
runtime bytes, and failures above remain part of the ledger.

## Final local release decision

Final artifacts: build/release-0219-final-2796-c_v2qg2b. Mandatory application/
ASAR/backend/native/CLI equality verification passes against the actual accepted
candidate. Portable EXE startup/legacy upgrade/data relocation/restart/exit
G8fhFJ and extracted folder ZIP BGwy3u pass with exit 0. CI=true only selects
the explicitly labelled mock manual-update response; real application and
filesystem operations are not mocked. No OS-cache-controlled cold-boot claim.

Additional actual final-package close while HDR is playing: uvAU6l PASS / 0,
15s measurement, 892 presented-serial advance, observed playback drop maxima
0/0. Real close log confirms helper dead, source lease released, 980 texture
imports/releases/GPU completions balanced, one NT lease opened/closed, clock
requests/releases 3/3. Original SHA/mtime unchanged. No --no-sandbox or disabled
GPU arguments were used for these acceptance runs.

LocalReleaseReady=true for the tested Windows/RDP scope. User accepted the
local build/upload release path; CI results remain owned by the user and are
not queried or asserted. Physical HDR second-screen/external devices, missing
real HEVC/AV1/HLG samples and physical colour certification remain unverified;
prior raw-range failures and initial native counters remain retained. Do not
claim all-system zero drops or a proven unique cause of the original failures.
This is a bounded, measured bugfix release, preserving all original engines,
quality policies and defaults. Proceed with a fresh v0.2.19 tag only on the
reviewed release commit; no old published tag/assets are replaced.

LOCAL-ACCEPTANCE.json and later publication receipts are sidecars, not claimed
inside the already sealed corresponding-source ZIP. The source ZIP contains
the frozen tested product sources and verified runtime/license materials.
