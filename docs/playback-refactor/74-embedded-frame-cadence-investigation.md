# Embedded frame cadence investigation

2026-11-01. Continues the held 0.2.19 candidate in [73](73-release-0219-local-candidate.md).
Version remains 0.2.19; HEAD remains 64ee25bedcea056bd6d13a9e0efb30ec7a3166f0.
No remote writes or CI polling. The 1/11 output-drop failures remain failures.

## Controlled follow-up, before product changes

Same-session actual packaged 0.2.19 / published 0.2.18 each ran 120 seconds
with the bounded timing observer: both PASS, exit 0. Reports:
hdr-real-media-ivFTm6 / hdr-real-media-g5EYC4. Both include a planned precise
seek; these are not continuous unique-footage or physical scanout certificates.

Two predetermined visibility comparisons requested visible → covered → restored
windows, first with a same-process cover, then a separately spawned self-closing
WinForms process. Both versions passed their 60-second diagnostic windows:
nBejKd / WPsK9S (same process), xCRWn8 / BUt3YV (separate process).
The renderer still reported visibility=visible. The same-process cover leaves
its process visible; neither test established that Windows actually enabled
its power-throttling policy. Do not claim that occlusion is proven or excluded
as the original cause. No policy/priority/timer-resolution override was applied.

Microsoft documents that Windows 11 may ignore high-resolution timer requests
for fully occluded/invisible/inaudible processes:
[timeBeginPeriod](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod),
[SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation).
This is a hypothesis reference, not a diagnosis of the failed runs.

## Measured scheduling cost and candidate

The existing pump waited another 10ms **after** completing host/frame/GPU work.
Observed mean task/wait was about 5.0/10.4ms, producing ~15.4ms cycles against
a 16.7ms frame interval for this 60fps source. This reduces scheduling headroom
even though GPU conversion itself was not measurably slower than the old build.

Small source change in electron/src/renderPlayer.ts: during visible playback,
subtract work elapsed from the existing 10ms cadence, round up and yield at
least 1ms. Paused/hidden timing remains unchanged. There is still only one pump
task and the original GPU receipt/release barrier; no extra decoded-frame copy,
queue, source load, global timer or Windows policy change. Original-quality
processing is unchanged. This is a headroom optimization, not proof of the
unique cause of every previous dropped frame.

Updated render-hdr-real-media.mjs supports actual packaged subjects directly;
records GPU identity, visibility/focus and timer ownership; optionally collects
existing resource or timing observations. Timings remain opt-in and explicitly
labelled. All calls still perform real work; zero-drop assertions remain intact.

## Current-source evidence

Source build ed97153c89cd754c, timestamp 2026-11-01T11:51:32.004Z. Logs below
are build/root-session-closeout/release-0219-cadence-*.

| Check | Status | Evidence |
| --- | --- | --- |
| frontend / Electron build | PASS / 0 | build / electron-build logs |
| contracts | PASS / 0 | 179 tests |
| before: fixed-delay packaged 0.2.19, 120s, timing observer OFF | original exit 0; later audit found a masked failure | hdr-real-media-5c4D9v; 7,182 presented-serial advance, final output counter 0 but observed sample maximum 1 before seek reset; sourceLoads=1 |
| after: actual source candidate, 120s, timing observer OFF | PASS / 0 | hdr-real-media-kv4vFt; 7,182 advance, decoder/output drops 0/0, sourceLoads=1 |
| after: timing/resource diagnostic, 60s | PASS / 0 | hdr-real-media-IeQbXp; 3,619 advance, drops 0/0; task/wait mean 3.201/7.517ms, cycle ~10.718ms; GPU present/release mean 4.095ms |
| actual SDR8 / Chromium return | PASS / 0 | render-app-flow-nqcoKn |
| actual 4K SDR10 controls / precision | PASS / 0 | render-app-flow-3HLJB3 |
| actual minimize / seven-second hidden / restore / source identity | PASS / 0 | render-app-window-Fcehpd |

120-second resource comparison: native CPU time 15.328s → 13.156s, Electron
CPU time 21.570s → 23.144s; combined ~36.898s → 36.300s. Native I/O including
protocol pipes 459,644,943 → 459,069,897 read bytes. Ending GPU usage identical
897,236,992 bytes. These are process CPU times, not percentages or energy
measurements; source vs packaged backend and uncontrolled OS caches limit a
strict performance attribution. The observations do not show a large CPU/I/O
increase; no all-device energy claim is made. Both runs were visible/focused.

Five-minute actual source run with the timing observer OFF: PASS, exit 0;
hdr-real-media-t9lbaM/report.json, source build ed97153c89cd754c. Four precise
seek resets, 17,885 presented-serial advance, sourceLoads=1, decoder/output drops 0/0; actual frame/resource
counts and original identity are retained in the report. This supports the
candidate at the tested scope, not a unique explanation of the earlier failures.

The existing
2d3d8934540d8439 EXE/ZIP does not contain this cadence change. Old package,
source-bundle, external-machine and physical-HDR evidence cannot certify the
new ed971 source. No stable release admitted yet. Real HEVC/AV1/HLG footage and
physical second-screen acceptance remain deferred/unavailable as recorded.

## Fresh ed971 packaged acceptance

New ordinary candidate build/release-0219-cadence-acceptance-bui59uu0, rebuilt
from the final-note snapshot/backend replay application-build-replay-VTGPJY.
All following checks PASS, exit 0, logs release-0219-v2-*:

- independent MPV: native-independent-Qy6Lq3;
- mode coexistence: mpv-window-coexistence-tcNR7b;
- native target pixels/controls/Chromium handoff: render-app-flow-qoX9HU;
- actual packaged real HDR 120s without timing observer: hdr-real-media-4IVWlX,
  7,176 presented-serial advance, one seek, sourceLoads=1, decoder/output drops
  0/0; original unchanged;
- actual packaged generated HLG 60.137s: render-app-soak-N6ZW4W, real compositor
  frame-code/wall ratio 1.000326, decoder/output drops 0/0, rawRangePassed=true
  for this short run, existing convergence and cleanup passed. This does not
  override older false long-run raw ranges or certify unlimited stability.

Final ordinary EXE/ZIP and source delivery still need sealing and actual
startup/upgrade acceptance. No remote mutation or release admitted yet.

## Subsequent audit / superseding source

The old real-media harness checked only the final native drop counter. A seek
can reset that counter: later sample audit found the 5c4D9v before-run had one
observed output drop even though its final counter and original exit were zero.
The table above is corrected; raw report/exit preserved. Other audited long
reports KlruEG, t9lbaM, 4IVWlX, kv4vFt, ivFTm6 and g5EYC4 have sampled maxima
zero. The harness now also checks observed measurement-window transitions and
sample maxima, so a later seek cannot hide a previously observed failure.

Further concrete cache/resume fixes and fresh acceptance are in document 75.
The ed971 package/source results remain historical and are not certification
of that newer source. It was not published.
