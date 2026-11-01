# Architecture optimization acceptance

Current implementation task, not a published-release or hardware certificate. Baseline and planned phases: [69](69-architecture-optimization-baseline.md).

**Latest local security gate (2026-10-31): PASS after the build-tool follow-up below.** Standard npm ci/npm ls/audit and related builds/integration pass, with zero vulnerabilities. The intermediate 15-moderate minimatch failure and rejected incompatible attempts remain recorded. Fresh packaged/hosted-CI/hardware acceptance is still separate and is not declared complete.

**Current gate: PASS LOCAL REBUILD, NOT RELEASE APPROVAL.** Following explicit
user authorization, new EXE/ZIP build 3f5396166505433f passes same-application
packaged acceptance, actual extracted-ZIP HDR/mixed-DPI/screenshot tests and
single-EXE startup/migration/exit checks. Old build 084031ef4f398db9 still lacks
the fix. External-computer tests are deferred by user, hosted CI is unrun and
physical color accuracy is not certified. Version remains 0.2.17; nothing was
committed, pushed, tagged or published. Latest details are at the end.

| Stage | State | Evidence |
| --- | --- | --- |
| A initial / intermediate / latest local | PASS / FAIL retained / PASS | initial ledger, retained minimatch exit 1, then toolchain-workflow-audit.json exit 0 with real dependency integration |
| A hosted/release gate | BLOCKED | no push/workflow dispatch authorized; remote cannot test local changes |
| B scoped PoC | PASS | default-off native save/close/seek path and real D3D11→Chromium return; full root migration is not claimed |
| C | PASS | explicit decision matrix, strict error policy, unchanged defaults; real handoff at current C source |
| D | PASS with limits | 1,040 actual paired target measurements, negative damaged stream, 22 remux tests; no speculative parameter tuning |
| E source / local candidate / external certification | PASS scoped / PASS new local rebuild / external deferred | fresh 3f5396166505433f EXE/ZIP and corresponding source evidence; old package's HDR failure retained; hosted CI unrun, physical color accuracy not certified |

Original logs and exit codes: build/codex-optimization. FAIL remains recorded even after a passing rerun; SKIP is not PASS.

## A — actual command ledger

| Command / scope | Result | Exit code / detail |
| --- | --- | --- |
| npm ci, before repair | PASS | 0 |
| npm audit --json, before repair | FAIL (expected baseline) | 1; full advisory JSON retained |
| npm explain fast-uri; npm explain undici | PASS | 0 each |
| npm audit fix --package-lock-only --ignore-scripts | PASS | 0; only three compatible resolutions retained |
| npm ci, after repair | PASS | 0 |
| npm audit --audit-level=moderate; npm audit --json | PASS | 0 each; zero vulnerabilities |
| npm run build; npm run build:electron | PASS | 0 each |
| focused playback-engine / mpv-engine / native-recovery Node contracts | PASS | 0 |
| node node_modules/electron/install.js | PASS | 0; runtime preparation, checks not disabled |
| first full verify-windows replay | FAIL, retained | 1; 192 renderer PASS / 2 FAIL after preceding gates passed |
| backend plus Windows short-path backend groups | PASS | 0 each; each reports 778 tests, 2 skipped |
| shared renderer contracts | PASS | 0; 56 cases |
| initial two UI defects, focused rerun | PASS | 0; 15 cases |
| resumed remaining-renderer group | PASS | 0; 194 cases |
| first resumed runtime-message group | FAIL, retained | 1; 16 PASS / 2 stale-mock FAIL |
| runtime-message mock repair, first focused run | FAIL, retained | 1; 1 PASS / 2 obsolete-message FAIL |
| runtime-message current-contract rerun | PASS | 0; 3 cases, includes no-startup-JS-error and disabled MPV assertions |
| final continuation from Read-only route recovery… | IN PROGRESS | build/codex-optimization/stage-a-final-workflow.json; not yet a completed run |
| hosted CI after local repair | BLOCKED | no authorized source push; remote cannot evaluate unpushed changes |

Detailed per-step commands are in stage-a-workflow.json, stage-a-resumed-workflow.json and stage-a-final-workflow.json. These are cumulative continuation records; no failed step is skipped. Node local 24.22.1 differs from workflow-pinned 24.19.0. This is a Windows local workflow replay, not a fabricated hosted-CI or release result.

### A completion

All 43 current source-verification workflow commands now have a matching successful execution. The cumulative ledger stage-a-complete.json binds each step to its exact workflow command and retained run record; failed historical attempts remain. Recycle group rerun: 99 PASS, exit 0. Remaining real Electron groups including library keyboard/visual checks passed. Final 60-second Electron playback/scan/thumbnail smoke: 1,273 decoded frames, 0 dropped, 0 waiting, 20 covers published, no pending work; exit 0. This short smoke is not a multi-hour or physical HDR test.

Additional fixture repair: native-quality used a /test URL rejected by the existing source guard; changed only the isolated intercepted URL to the authorized media HLS namespace, preserving invalid segment data and no-encoding assertions. Seven focused tests and all 42 delivery/recovery cases passed (exit 0). Workspace light/dark and real Electron keyboard checks now traverse the existing Appearance tab; 3 focused cases passed (exit 0). No product UI or source authorization rule changed in A.

Hosted CI remains BLOCKED, not green: no remote writes are allowed. A completion permits local incremental source work, not publication.

## B — actual verification and explicit limits

| Check | Result | Exit / evidence |
| --- | --- | --- |
| current combined coordinator/playback-engine/mpv-engine/native-recovery Node contracts | PASS | 0; 42 tests including 14 coordinator cases; stage-b-contracts-final.log |
| native preference/read-lease backend tests | PASS | 0; 4 cases, strict true/false including new flag |
| frontend and Electron builds | PASS | 0 each; stage-b-final-exits.json |
| native settings/lifecycle/playback memory renderer harness | PASS | 0; 26 cases; stage-b-ui-v2.log |
| initial new settings harness | FAIL, retained | 1; check() expected immediate checked state before async durable ACK; fixed test to click and await checked/un-checked plus durable GET/reload, no assertion removed |
| first native attempt | FAIL, retained | 1 before launch: absolute candidate path correctly rejected; supplied required safe candidate directory name on retry; no safety check changed |
| real Electron coordinated ordinary sample | PASS | 0; build/render-app-flow-4WRf4i/report.json; stage-B intermediate source only |
| real Electron current legacy flag-off path | PASS | 0; stage-b-render-legacy.log and its actual report; no session-phase attribute |
| real Electron current coordinated 4K SDR10 | PASS | 0; build/render-app-flow-IorG9G/report.json; actual compositor barcodes, original dimensions, 16-bit PNG screenshot, fullscreen/pure mode, stopped host and released leases/textures |
| real Electron current coordinated return to Chromium | PASS | 0; build/render-app-flow-PQB0LW/report.json; actual decoded barcode, position/pause, original /media/id/file, durable MPV preference unchanged |
| physical HDR scanout, mixed-DPI/multiple displays | BLOCKED | available validation is SDR; no physical certification implied by SDR10/compositor proof |

The current B source hashes are in stage-b-source-sha256.json, so later source changes cannot silently relabel these as final-release acceptance. Original media fixture hashes and mtime are unchanged in the real reports. Every successful native report independently asserts helperAlive=false, sourceLeaseReleased=true and imported textures/leases fully released. The 14 coordinator cases are explicitly contract models: stale seeks/subtitle events, immutable queued inputs, 30 cancelled requests plus 30 acquired/released sessions, three-kind roundtrip, one safe recovery, denied unsafe recovery, pending-open cleanup, concurrent save/close failure/retry. They do not certify actual independent↔D3D11↔Chromium full production migration.

## C — actual verification

| Check | Result | Exit / scope |
| --- | --- | --- |
| combined Node contracts with decision/error tables | PASS | 0; stage-c-contracts-final.log; includes explicit/default/auto, missing adapter, authorization, runtime failure, unverified HDR, deprecated scope alias, actionable typed faults and hostile/misleading text |
| frontend / Electron builds | PASS | 0 each; stage-c-final-exits.json |
| settings, runtime messages, native lifecycle, original-quality renderer cases | PASS | 0; 26 cases; stage-c-ui.log |
| current C real Electron native→Chromium original handoff | PASS | 0; build/render-app-flow-uh4TRy/report.json and stage-c-native-exit.json; source, frame, pause, saved preference and native disposal checked |
| auto performance policy rollout | SKIP | intentionally not enabled without an admitted measured policy; persisted playerEngine still rejects auto |
| HDR physical certification / device-removal fault injection | BLOCKED / SKIP | no physical HDR/multidisplay setup or actual forced GPU-loss evidence; contract categories do not substitute for it |

C source digests: stage-c-source-sha256.json. No FFmpeg/cache defaults changed. Full root-engine migration and release approval are not inferred from these scoped results.

## D — measured results and failures retained

Full paired data: build/codex-optimization/stage-d-comparison.json. Same physical fixture SHA, mtime and API source fingerprint were asserted across old/coordinated runs. Each healthy row has 20 nonmonotonic initial-cache targets and the same 20 repeated targets. Both actual Node commands returned 0 for all final pairs; GPU counter status was PASS where sampled. The workload includes compositor verification; resource numbers are not isolated decoder cost or peak counts.

| Category | Result | Evidence / limitation |
| --- | --- | --- |
| H264 MP4 direct / TS indexed-ts / MKV indexed-remux, Chromium and native | PASS | 480 targets; build/m4-seek-matrix-eENopQ and Ybfte8; one delivery request per Chromium row, no native delivery conversion |
| generated 4K HEVC MKV/MP4, AV1 MKV, SDR10 MKV | PASS | 320 targets; build/render-codec-seek-5L65qc and So1n7S; original dimensions and compositor target barcodes |
| missing colour metadata / external ASS | PASS | 160 targets in final pair; unverified colour is allowed; selected ASS demonstrably changes compositor while the video frame stays fixed |
| real 4K VP9 MKV, 4,111,060,107 bytes | PASS with target-proof limit | 80 targets on one unchanged owned full copy; original streaming SHA/mtime/inode unchanged; actual GPU PTS and changing compositor hashes, no independent natural-picture timestamp barcode |
| damaged indexed MP4 stream | PASS negative / seek SKIP | both modes visibly fail without silent engine change, then dispose; a damaged stream cannot honestly have 20 successful decoded seeks |
| natural large HEVC / natural AV1 | SKIP | bounded read-only discovery checked 10 selected MKVs, not an exhaustive codec inventory; generated HEVC/AV1 results do not certify large natural samples |
| remux dedup/cancellation/queue/LRU/source change | PASS | 0; 22 tests in stage-d-remux-tests.log |
| rawRangePassed historical gate | NOT PASSED | remains false; a new latency metric does not replace the old unproven raw-Range acceptance |
| physical HDR / mixed DPI | BLOCKED | no matching physical setup; not a playback admission whitelist |

Complete compatibility runs after the visible-first-frame fix: build/render-compatibility-seek-VNWFDb/report.json and 2lYAwI/report.json, both exit 0. Earlier m4/codec timings precede that bounded-startup-only fix and are retained as scoped comparisons, not final packaged acceptance. Complete total: **1,040 actual target measurements**. Differences include noise and some slower tails; no reproducible general gain justifies changing defaults or expanding auto/coordinator admission.

Retained failures: the first 1024-byte damaged fixture was correctly excluded by scanning (exit 1 from an unsuitable test fixture); bytes preserved in first-failures/corrupt-header-only-1024.bin. Replaced only the owned fixture recipe with valid container metadata plus corrupted mdat, which exposed the real infinite-preparation bug (exit 1 after 35 seconds). After the product fix, both actual old/new paths returned actionable errors and released all helper/texture/read-lease ownership. No original E:\\downloads file was modified.

## E — evidence boundary and release limits

| Check | Result | Exit / evidence |
| --- | --- | --- |
| identity/resource/source/report contracts | PASS | 0; final-focused-contracts.log has 54 combined tests, including 10 release-evidence contracts; includes changed identity collector, unbuilt public/native sources, stale version/build, report mutation, mixed EXE/ASAR, whole dependency-tree changes and a positive fake-byte final layout |
| existing packaging/distribution policy contracts | PASS | 0; stage-e-policy-tests.log, 17 cases at that checkpoint; fake contracts are not packaged playback proof |
| Python compilation, Node syntax, PowerShell parser | PASS | 0; no build-windows invocation or new package produced |
| stale 0.2.16 M5 binding supplied to current preparation | PASS negative | expected exit 1; stage-e-stale-input-rejection.log; existing receipt unchanged |
| existing original 0.2.17 assets/source ZIP | PASS historical integrity | 0; stage-e-historical-017.json; 1,168 member hashes, original EXE/ZIP/source digests, folder ZIP vs historical extracted bytes |
| real historical 0.2.17 embedded render | PASS historical application | 0; build/render-app-flow-V4Hlgi/report.json; real barcode seeks, screenshot, controls, fullscreen and cleanup; not optimized-source acceptance |
| real historical 0.2.17 independent/coexistence | PASS historical application | 0 each; native-independent-a1hh1y/acceptance.json, mpv-window-coexistence-aQrUu7/report.json; actual subject metadata, bytes and bundled runtimes |
| current source opt-in coordinated D3D11→Chromium original handoff | PASS source desktop | 0; build/render-app-flow-u31IPh/report.json; current build 874a3135e58ef4c3, actual original barcode/seek/screenshot/fullscreen/pure-mode/cleanup; subject kind is source-desktop, not packaged proof |
| current optimized-source ordinary EXE/ZIP / source bundle generation | SKIP | not requested; no new package built; historical reports are refused as current proof |
| clean Windows / another physical device on this exact optimized build | BLOCKED | no new candidate or exact-build second-device evidence |
| physical HDR scanout / mixed-DPI | BLOCKED | no available physical setup; no media admission limitation added |
| dependency security at this checkpoint / hosted CI | FAIL retained / BLOCKED | audit exit 1 retained; security resolved by the later toolchain follow-up; no remote writes performed |

Failures retained: initial historical-release inspection incorrectly looked for generated app/build-info.json inside an old source archive; its actual DELIVERY-INDEX.applicationBuild supplies the historical identity. New delivery now explicitly includes generated metadata, so the new preparation contract can check its file hash. First historical-package harness tried sending the new coordinator=false preference to an old backend, correctly rejected; only send the new key when explicitly opting in on a supported build. Second attempt exposed a test pointer outside the visible control area; reveal now scrolls actual controls into view before moving the real pointer. No product mouse logic or error assertion was disabled. Current report capture also hashes the identity collector; reports from before that change remain historical evidence, not schema-2 release-admission fixtures.

Latest installation: first npm ci stopped with EPERM/-4048 on the running development Electron's d3dcompiler_47.dll. No process was killed or file forcibly removed. After the user closed that window, npm ci and explicit Electron installation both returned 0; logs final-npm-ci-retry.log and final-electron-install.log. The lock still changes only the original three compatible security resolutions. Audit JSON final-audit.json reports 15 moderate / 0 high / 0 critical and returns 1; advisory details and the first failed full replay remain independently recorded. Normal and Windows-short-path backend reruns each report 778 tests, 2 skips, exit 0. Remaining verification is recorded step-by-step in final-workflow-continuation.json and does not override the audit failure.

### Reproduce the gates (PowerShell, project root)

These are manual instructions, **not authorization to package/publish**. Close running development windows before npm ci. No step below uses --force, disables audit/hash checks or authorizes encoding.

```powershell
npm ci
node node_modules/electron/install.js
npm audit --audit-level=moderate
# Stop release preparation here if audit is nonzero.
npm run build
npm run build:electron
python scripts/verify-windows.py --execute --report build/codex-optimization/recheck-workflow.json

# Optional current-source native PoC, using a separately verified owned runtime:
$env:AVHUB_RENDER_RUNTIME_CANDIDATE='render-replayed-candidate-7wRYRz'
$env:AVHUB_TEST_SESSION_COORDINATOR='1'
$env:AVHUB_TEST_SESSION_HANDOFF='1'
node electron/test/render-app-flow.mjs
Remove-Item Env:AVHUB_RENDER_RUNTIME_CANDIDATE,Env:AVHUB_TEST_SESSION_COORDINATOR,Env:AVHUB_TEST_SESSION_HANDOFF
```

If packaging is later explicitly authorized and audit passes: freeze current source/build timestamp, rebuild the matching controlled backend/native inputs as required, and use desktop-render.builder.cjs for a nonpublishing candidate. Do not reuse the old M5 directory or reports. Record M5-BUILD-INPUTS.json with current buildIdentity, actualBackend, actualBackendSourceReplay, nativeRoot and independentRuntime; these fields name actual owned outputs, not a hand-written claim of successful tests. Run all three harnesses against the same freshly built ordinary candidate:

```powershell
$env:AVHUB_TEST_PACKAGED_EXE='D:\AI\codex\avhub\build\<new-candidate>\win-unpacked\AVHub.exe'
$env:AVHUB_TEST_DESKTOP_RENDER='1'
node electron/test/native-independent.mjs
node electron/test/mpv-window-coexistence.mjs
node electron/test/render-app-flow.mjs
# Each must exit 0; preserve the distinct printed report paths.
Remove-Item Env:AVHUB_TEST_PACKAGED_EXE,Env:AVHUB_TEST_DESKTOP_RENDER

# Freeze matching application-source/replay inputs first; never point at old 0.2.16 material.
python scripts/stage-m5-source-delivery.py --directory build/<new-materials>
python scripts/prepare-desktop-release-inputs.py --directory build/<new-materials> --independent-test build/<new-independent>/acceptance.json --coexistence-test build/<new-coexistence>/report.json --render-test build/<new-render>/report.json
node electron/release-evidence.cjs verify . build/desktop-release-inputs.json
# Only when separately authorized: run the normal build script with the frozen timestamp.
# Its mandatory final artifact check refuses different EXE/ASAR/resource bytes.
```

Placeholders must be replaced with the outputs from the same new build. Full source/material rebuild prerequisites remain in M5-LOCAL-ACCEPTANCE.md and the controlled source recipes; no generated receipts, old hardware report or synthetic contract bypasses these gates. If repeated packaging produces different executable bytes, verify that final candidate afresh and reseal its reports; never remove the final hash comparison to make it pass. No commit/push/tag/Release was performed in this task.

## Pre-toolchain local regression checkpoint (retained)

The full attempted workflow stopped at audit with exit 1 (final-workflow.json). An explicit diagnostic continuation from Build shared UI and Electron then completed **all 42 remaining workflow commands**, each exit 0, in 2,416.3 seconds (final-workflow-continuation.json). This is **42 successful non-audit steps plus one failed audit**, not a successful 43-step workflow. Current command inventory still includes the audit unchanged. Latest focused contracts independently passed 54 cases, including 10 release-evidence cases after the final public/native-source seal addition.

| Final scope | Result | Exit / actual evidence |
| --- | --- | --- |
| frontend and Electron compilation | PASS | 0 each, first continuation step |
| ordinary / Windows 8.3 backend suites | PASS | 0 each; each ran 778 cases, 2 explicitly skipped |
| renderer harness groups | PASS | 0 each; 56 + 8 + 194 + 19 + 85 + 92 + 42 + 99 + 4 + 7 + 21 = 627 passed; these are renderer harnesses, not physical desktop playback certification |
| actual Electron workflow groups | PASS | every recorded command 0, including library, settings, save/close, original playback and visual contracts; exact commands/logs in the continuation ledger |
| 60-second actual Electron playback/scan/cover smoke | PASS bounded | 0; 1,273 decoded frames, **1 dropped frame**, 0 waiting, 21 covers published, 0 pending; final-concurrent-soak.json; not zero-drop or multi-hour acceptance |
| opt-in current D3D11→Chromium handoff | PASS source desktop | 0; native and Chromium frame 104, position 4.16 seconds, paused, original /media/1/file and unchanged preference; 61 imports / 61 releases, stopped helper and released source lease |
| latest npm audit / release readiness | FAIL / BLOCKED | 1; final-audit.json and final-workflow.json; no force, suppression or automatic rollout |
| final whitespace / baseline / user plan | PASS | git diff --check 0, HEAD remains 9e734f3a7a228e9af1516fdcbeb14174d5ea29ac; plan SHA256 remains 754825c38768ed197177696883545f47da70102ae03a7340c130fa0b8ed23ae3 |

No files in the frozen archive were modified. Application/lock version remains 0.2.17. No commit, push, tag, package or Release was created. Coordinator default remains off; all existing engine paths remain. E's source/evidence tooling is implemented and locally checked, while fresh optimized-build packaged/second-device/HDR/DPI acceptance remains SKIP/BLOCKED as listed above. Next priority is resolving the upstream minimatch build-tool dependency chain with a compatible update or a separately verified toolchain migration, then re-running audit before any rollout or release preparation.

## Latest build-tool security follow-up — local P0 PASS

This section supersedes the intermediate minimatch BLOCKED conclusion. It does **not** relabel the earlier full workflow, measurements or historical packages as newly rebuilt/retested artifacts. The default-off coordinator scope is unchanged.

| Command / scope | Result | Exit / evidence |
| --- | --- | --- |
| fresh isolated final candidate: normal install, npm ci, npm ls, audit and component integration | PASS | 0 each; dependency-candidate-*-v7 logs; final selected candidate is dependency-candidate-4oe97l_q |
| main project npm ci with normal postinstall | PASS | 0; toolchain-root-ci-final.log; actual owned alias/version and upstream hash verified before two-call adaptation |
| main npm ls | PASS | 0; toolchain-root-tree-final.log; no invalid local links or peer/dependency graph errors |
| npm audit --audit-level=moderate / --json | PASS | 0 each; toolchain-root-audit-final.log, toolchain-audit-final.json; 0 info/low/moderate/high/critical |
| explicit Electron runtime installation | PASS | 0; toolchain-root-electron-final.log; no sandbox/hash checks disabled |
| frontend / Electron builds | PASS | 0 each; root build logs plus exact current workflow step in toolchain-workflow-build.json |
| actual build dependency integration | PASS | 0; 8 cases in toolchain-root-integration-final.log; real matching/ASAR/stream transforms/byte integrity/exit cleanup/guard refusal/cancellation/adversarial-pattern checks on owned fixtures, not a packaged app |
| complete current native control queue / engine / source policy workflow step | PASS | 0; toolchain-workflow-contracts.json; includes the new 8 integration cases and retained coordinator/engine/evidence contracts |
| release builder/resource/distribution policies | PASS | 0; 10 cases, toolchain-release-policy-rerun.log |
| exact current audit workflow step | PASS | 0; toolchain-workflow-audit.json |
| default-security actual Electron startup/shutdown | PASS | 0; toolchain-workflow-startup.json and toolchain-electron-smoke-default-sandbox.log; ordinary application arguments, no --no-sandbox or disabled-GPU test override |
| actual current source independent MPV app flow | PASS | 0; build/native-independent-BT1zeV/acceptance.json; current build 084031ef4f398db9; source subject, not packaged proof |
| actual current source coordinated D3D11→Chromium original handoff | PASS | 0; build/render-app-flow-vNShyd/report.json, build 084031ef4f398db9; both frame 104 / 4.16 seconds / paused, original file endpoint and unchanged saved preference; 60 imports / 60 releases, host stopped and lease released |
| prior all-remaining workflow / 627 renderer cases / D benchmarks | RETAINED scoped evidence | no unrelated product UI, FFmpeg, playback-default or quality change in this follow-up; these were not rerun or relabelled as fresh toolchain-package proof |
| fresh exact-build EXE/ZIP/source delivery | SKIP | not authorized/requested; byte fixtures above are not application packaging |
| hosted CI / clean second device / physical HDR and mixed DPI | BLOCKED | no remote mutation, new packaged candidate or matching physical setup; no playback admission whitelist |

Failed attempts retained: a modern ASAR candidate exposed glob's cancellation advisory; glob14 fixed that but the remaining glob7 really broke against minimatch11 (missing matches and TypeError). This was rejected, not silenced. Two local-file override approaches produced invalid relative links; npm ci or the actual package-identity guard rejected them. Final solution uses a registry tmp alias with exact upstream SHA256 adaptation, not a fabricated version, empty dependency stub or audit exclusion. The obsolete temp/rimraf/glob7 modules are absent. An initial test tried unsupported Windows FileList nested patterns; the original dependency reproduced the failure, and its supported root-pattern API plus EJS and the actual installer helper remain exercised.

The first startup attempt used the existing harness's --no-sandbox/disabled-GPU arguments and is excluded from normal-security acceptance. The harness was corrected and the exact workflow startup step re-run with ordinary flags, exit 0. The losing 30-second timeout is now unreferenced instead of keeping an already successful test alive. No application sandbox setting changed.

Two native flow attempts failed around pure-playback window layout: first toolbar visibility, then a hidden exit button intercepting pointer action. Reports render-app-flow-h8pHXb and ixr30w remain, with cleanup complete. The harness now re-reads actual control geometry and hovers the actual exit button after the native window resize, then performs a normal click. There is no forced click, DOM state override, synthetic media event or removed assertion. Current handoff/fullscreen/pure-mode/screenshot/frame/cleanup checks pass. A policy invocation initially used nonexistent filenames and ran no tests (exit 1); the corrected three existing policy suites ran all 10 cases, exit 0.

The security follow-up changed build dependencies, install-time compatibility and test harnesses only. Version remains 0.2.17. Application playback defaults, quality/conversion permissions, user settings/data, original media and the frozen archive were not changed by this follow-up. No application package, commit, push, tag or Release was created. Before publication, independently authorize and verify a fresh candidate against current source and schema-2 evidence; old 0.2.16 or historical 0.2.17 reports cannot replace that gate.

## Subsequent local candidate acceptance (2026-10-31)

The user's continuation followed the proposed local-product acceptance. This section supersedes earlier packaging SKIP for local artifacts only. It does not authorize remote publication, a version increase or release certification. Output directory: **build/architecture-local-acceptance-l1mg4w5l**. Current version 0.2.17 / build **084031ef4f398db9**, frozen timestamp 2026-10-31T07:59:42.374Z. Git HEAD stays 9e734f3a7a228e9af1516fdcbeb14174d5ea29ac; this is an explicitly dirty-working-tree source snapshot, not a new commit/tag.

| Scope | Result | Exit / evidence |
| --- | --- | --- |
| exact current workflow command coverage | PASS cumulative | 0 for all 43 current commands, candidate-workflow-complete.json; not a one-attempt or hosted-CI green run |
| failed workflow attempts | FAIL retained | initial PowerShell timestamp conversion stopped prebuild; later test server startup exceeded the unchanged 60-second limit; later library-refinement pointer clicked hidden controls. Original reports remain; failing steps passed on correction/retry |
| renderer / backend scope | PASS with skips | 627 renderer cases; each full backend run 778 cases, 2 skips; 4 new source-delivery identity cases run separately after initial discovery, not claimed as part of the earlier 778 |
| additional build integration / timestamp | PASS | 0; 9 cases, candidate-build-timestamp-tests-v2.log; includes the actual timestamp assignment parsed from production PS1, using available Windows PowerShell/pwsh without changing execution policy |
| latest frozen source replay | PASS | 0; build/application-source-review-s2bgw3o9 and application-build-replay-KB6gP9; exact lock, normal lifecycle policy, explicit audit and frontend/Electron builds; individual commands/logs in replay-report.json |
| backend rebuild / executable check | PASS | 0; candidate-backend-replay-v5.log and replay receipts. Actual package backend derives from verified SXICpm runtime-identical Python inputs plus the separately verified controlled CLI overlay; both actual and replay receipts are delivered, not relabelled |
| same-byte packaged independent / coexistence / default render | PASS | 0 each; native-independent-krlAqa, mpv-window-coexistence-iiLqKA, render-app-flow-p5C5TU; actual packaged EXE/ASAR and whole runtime trees match schema-2 target |
| packaged opt-in coordinator / original handoff | PASS | 0; render-app-flow-vHYlxR; actual frame/position/pause and original source preserved; global engine preference unchanged |
| actual final single EXE | PASS | 0; portable-release-test-o0cJUz/startup-timings.json and final-portable-acceptance.log; legacy metadata/favourite/progress/playlist preserved, generated original H264 frame, privacy/settings and explicit data relocation, three launch/exit cycles |
| actual final folder ZIP | PASS | 0; folder-release-test-vhwhMx/startup-timings.json and final-folder-acceptance.log; same migration/persistence/frame/exit coverage after real extraction |
| native path on final extracted ZIP | PASS | 0; render-app-flow-R26o6n/report.json; actual bundled DLL paths, native screenshot/fullscreen/pure-mode/original handoff and released host/texture/lease checks |
| final unpacked bytes / every ZIP member | PASS | 0; final-candidate-artifact-verify.log and final-zip-byte-audit.json; all **682 files** match the tested payload; final inner EXE SHA256 04a8cd088863e4d04754b1154ceef3451fcaf367f3044bfe0453897d85c3ca75, ASAR f95fe7297d803e759cc20ae6abe53c42b446bb8134d2560f31169bc26fb78dc5 |
| 60-second concurrent workload | PASS bounded | 0; candidate-concurrent-soak.json: 1,272 decoded frames, **3 dropped**, 0 waiting, 20 covers published, 0 pending. Not a zero-drop, hardware-wide or multi-hour claim |
| original/raw Range historical diagnostic | NOT PASSED | rawRangePassed=false remains unchanged; other successful metrics do not replace it |
| clean second device / physical HDR / mixed DPI / hosted CI | BLOCKED | current exact build has no matching external evidence; original media including HDR remain allowed, not a test whitelist |

The packaged migration tests use isolated synthetic old-schema data and one generated H264 clip, not a real user backup or full library. Manual update interaction uses the existing deterministic CI response, not a live GitHub result. Startup runs occur without OS cache flushing and alongside other validation: single-EXE library-ready times were about 13–16 seconds including extraction, while folder runs were about 0.8–2 seconds. These are diagnostic observations, not a controlled before/after performance claim. Prefer the folder ZIP for routine local use.

### Concrete delivery fixes discovered by this acceptance

* replay-application-build.mjs previously disabled lifecycle scripts and audit. It now uses the ordinary lifecycle policy and an explicit moderate audit, with actual per-command exit codes/logs. Both source and replay copies are hash checked; latest source identity is frozen before rebuilding.
* Generated app/build-info.json is intentionally absent from the source-review inventory. Source delivery incorrectly tried reading it from the snapshot (real exit 1 retained). It now takes metadata from the successful replay of that exact snapshot, checks frozen metadata/package version, and records the generated file in the source ZIP. Four cases cover wrong source, failed replay, changed build/timestamp and version mismatch.
* Full-tree matching correctly found 7 FastAPI .agents development documents omitted by Electron's resource copier. The stage now explicitly excludes development-agent metadata; the extra staged copies were preserved in build/candidate-dev-metadata-d9m0q2bg. Runtime/license files and every remaining tree hash are still checked; no hash exclusion was added to release admission.
* PowerShell JSON date coercion could localize the frozen timestamp. build-windows.ps1 now reads the already-verified timestamp as raw JSON text through Node. The actual assignment passes the cross-shell test; neither timestamp validation nor script execution policy was weakened.
* The real Chromium library-refinement harness now scrolls/hovers the actual quality button and asserts visible controls before normal clicking. The initial interception failure is retained; no forced click, product UI or loading indicator workaround was introduced.

The initial material ZIPs and earlier input receipts remain validation history in build/architecture-candidate-pnjfyk57. The final selected source material is AVHub-source-materials-0.2.17-validated.zip, with all indexed member hashes checked and exact archive SHA256 recorded in the final schema-2 receipt and SHA256SUMS.txt beside the local artifacts. Source materials contain approved native/CLI archives and recipes, manifests and licenses, application source plus these records; no user library, videos, Git configuration or node_modules is delivered.

### Stage conclusions and next gate

| Stage | Conclusion |
| --- | --- |
| A | PASS local; hosted CI BLOCKED until an explicitly authorized source push/run |
| B | PASS scoped default-off PoC; not a claim that all three production owners have migrated to a root coordinator |
| C | PASS explicit decision/recovery matrix; defaults/quality permissions unchanged |
| D | PASS with the recorded 1,040 paired targets and stated sample/hardware limits; no speculative FFmpeg/cache/default tuning |
| E | PASS local candidate and source/evidence checks; external clean-device/display certification BLOCKED |

Keep the coordinator off by default until broader usage justifies rollout. Next external check should use this exact build on another physical Windows computer, testing independent MPV and embedded D3D11 playback/seek/screenshots/fullscreen/minimize/restore; older builds cannot certify it. The one-off renderer test-server startup timeout passed on retry but has no proven root cause and remains a test-infrastructure observation to investigate, not a fabricated product fix. No application version bump, commit, push, tag, online Release or auto-update publication occurred. Existing user data, original media and the frozen browser archive remain untouched.

## Physical HDR / mixed-DPI follow-up (2026-10-31)

External-machine acceptance is now **DEFERRED by user**, not required for this
local display run. No physical test results are borrowed from old M5 packages.
Summary: build/physical-display-acceptance-b13d2zrp/summary.json.

| Check | Result | Exit / actual evidence |
| --- | --- | --- |
| real monitor topology and HDR state | PASS inventory | 0; actual app probes in reports below, PHL SDR 125%/120 DPI; Samsung portrait HDR 175%/168 DPI, OS HDR active, 10-bit output |
| existing final extracted ZIP, three fixtures × SDR→HDR→SDR | PASS bounded playback | 0; physical-app-5WMS2Y/report.json, build 084031ef4f398db9; fullscreen, minimize/restore and new rendered frames; one source open per fixture |
| expanded same-package screenshot test | FAIL real defect | 1; physical-app-2I7Mvn, MKzo7G and NscRr5 reports; H264 and SDR10 screenshots pass, HDR PNG rejected; UI error and actual mDCV PNG retained |
| screenshot validator regression | PASS | 0; 21 cases after the new real HDR fixture / metadata tests; initial sandbox temporary-folder denial exit 1 retained as environment failure |
| full backend regression after HDR fix | PASS with skips | 0; 784 tests in 189.610s, 2 skipped; build/physical-display-acceptance-b13d2zrp/backend-regression.log |
| frontend and Electron builds after fix | PASS | 0 each; npm run build, npm run build:electron; source build 3f5396166505433f, version 0.2.17 |
| fixed source, coordinator off | PASS 9 cases | 0; physical-app-Hr3xtI/report.json, actual Electron, 3 fixtures × both displays and return to first |
| fixed source, coordinator opt-in | PASS 9 cases | 0; physical-app-KPdbPI/report.json, same build, isolated explicit preference only |
| harness syntax | PASS | 0; node --check electron/test/physical-display-acceptance.mjs |
| external physical computer | SKIP user deferred | not represented by this machine's result |
| physical luminance/gamut accuracy, dynamic HDR, HLG | NOT CERTIFIED / NOT TESTED | generated PQ sample is 1024×256 Main10; SDR10 sample is 4K; neither means full 4K HDR / HLG / Dolby Vision / colorimeter validation |
| fixed application packaging / source delivery refresh | SKIP | not performed or authorized in this display-only follow-up; old EXE/ZIP/source archive do not contain this fix |

Source runs preserve native hardware decode (d3d11va), actual imported PQ / BT.2020
frame metadata, and the F16 WebGPU path. All 18 source cases exercise seek,
original-resolution screenshot, fullscreen enter/exit, minimize/restore and
rendered-frame progression. Cross-screen operations leave sourceLoads=1;
three hosts per run exit and release all texture imports and source leases.
10-bit SDR and HDR captures are 16-bit PNG; the original mDCV/cICP metadata is
preserved without rewriting. Recorded screenshot end-to-end times include
UI hover/click and publication, so they are not isolated encoding benchmarks.

The first sandbox application launch failed before startup. A subsequent
harness assertion incorrectly expected state.error=null, but this public
snapshot uses phase; its failure is retained in physical-app-pjeVKy. Corrected
assertions require ready phase, one source load and real DPI/frame state.
Neither environment nor harness failures are claimed as product fixes.

**Release gate:** build/codex-optimization/final-local-candidate.json now records
localPassed=false and the prior pass as historical. The existing candidate
cannot be called HDR-screenshot-complete. The fix passes current source real
Electron tests; a freshly authorized package and matching source/material
receipts must be rebuilt and accepted before release. No version increment
or remote mutation has occurred. Physical color accuracy remains unverified,
but this does not prohibit users from playing HDR or untagged media.

## Extended 4K PQ / HLG and source-review follow-up

Same source build **3f5396166505433f**, version 0.2.17. Fixtures are explicitly
synthetic code-value charts. No claim of real-film mastering, HLG system-gamma
accuracy, HDR peak luminance, Dolby Vision or dynamic-metadata correctness.
Existing personal video files were not changed. No EXE/ZIP or Release created.

| Check | Result | Evidence / exit |
| --- | --- | --- |
| generate owned 4K 10-bit PQ / HLG fixtures | PASS | 0; physical-hdr-fixtures.mjs; build/physical-hdr-fixtures-bvRFQC/fixtures.json; original/source hashes retained, first decoded YUV samples byte-identical |
| actual source Electron, coordinator off | PASS | 0; physical-app-54gYet/report.json; 6 cases, 120 pixel-confirmed seeks |
| actual source Electron, coordinator on | PASS | 0 persisted; physical-app-AFa2Jm/report.json and hdr-4k-coordinated-exit.json; 6 cases, 120 pixel-confirmed seeks; explicit ready attribute proves opt-in coordinator attached |
| earlier coordinated run | PASS scoped report | physical-app-gN5VZF/report.json; process exit output was not retained, so replaced by the durable-exit run above for command acceptance |
| actual 4K PNG bytes / CRC / color tags | PASS | 0; hdr-4k-byte-audit.json, 12 audited cases from 54gYet/AFa2Jm; 3840×2160, 16-bit, BT.2020 cICP transfer 16 (PQ) or 18 (HLG), all chunk CRCs checked |
| release-evidence regression | PASS | 0; 10 cases, release-evidence-tests.log |
| stale receipt rejection | PASS negative gate | validator exit 1 as expected, wrapper exit 0; stale-receipt-gate.json and stale-receipt-verification-final.log; exact frozen-build mismatch, not a missing-input error |
| source fixture delivery | PASS | 0; 5 tests, source-delivery-fixture-tests.log; exact HDR PNG included and unrelated PNG/video excluded |
| harness syntax / actual snapshot fixture identity | PASS | 0; node --check both new harnesses; actual staged inventory includes expected fixture SHA256 |
| latest read-only dependency audit | PASS | 0; npm audit --audit-level=moderate --json, final-audit.json, all severity counts zero; no dependency installation/update |

All report paths without a directory prefix above are relative to
build/physical-display-acceptance-b13d2zrp. Frame time measurements include
compositor capture and polling; they are target-accuracy evidence, not seek
performance benchmarks. These 240 targets are additional physical HDR test
coverage and do not relabel or replace Stage D's earlier 1,040 paired targets.

Retained initial test failure: physical-app-myILRq reached HLG and incorrectly
expected FFprobe's arib-std-b67 name from VideoFrame, which uses hlg. The
harness naming assertion was corrected; no product transfer function or
decoder behavior changed. Source-open counts remain one per file across
screens; both native hosts per run stop and all imported textures and source
leases are released. Final coordinated rerun also checks the actual session
attribute; default preference remains off.

Current records at the beginning of 69/70 now explicitly supersede the old
local-product PASS. The old candidate remains rejected for packaging with
new source. A new source-review directory is an uncommitted working-tree
review snapshot, not an application package or release-commit certification.
Latest path is recorded in build/application-source-review-latest.json.
The current source-only follow-up still needs freshly authorized local
packaging and corresponding fresh runtime/source/test receipt checks before
the product release gate can pass. External physical tests remain user-deferred.


## Final user-authorized local rebuild acceptance (2026-10-31)

The user explicitly allowed local EXE/ZIP and source-material rebuilding,
without version increment, commit, push, tag or publication. Candidate:
**build/architecture-hdr-acceptance-j89_kwv1**. Version **0.2.17**, build
**3f5396166505433f**, frozen timestamp 2026-10-31T10:32:29.594Z. Same Git HEAD
9e734f3a7a228e9af1516fdcbeb14174d5ea29ac; working-tree build, not a release commit.

| Check | Result | Exit / evidence |
| --- | --- | --- |
| latest source snapshot normal npm ci, audit, frontend/Electron builds | PASS | 0 each; application-build-replay-7S8ymX/replay-report.json, source snapshot application-source-review-p0jkifeu; lifecycle enabled, audit not bypassed |
| actual packaged backend source replay | PASS | 0; application-build-replay-nKFviq/backend-replay-report.json; backend SHA256 c603b433d529d5236483e36a14ca5c58dd7f62960bd823867b7f69035424522e |
| latest source replay backend verification | PASS | 0; application-build-replay-7S8ymX/backend-replay-report.json; both actual and latest replay records delivered, not relabelled as one snapshot |
| actual candidate independent MPV | PASS after retained failure | 0; native-independent-FLbQkP/acceptance.json; initial 0toYx1 hover assertion exit 1 remains; unchanged assertion passed on retry, root cause not confirmed |
| actual candidate coexistence / default render | PASS | 0 each; mpv-window-coexistence-H8WBd4/report.json, render-app-flow-lrY4hi/report.json |
| candidate 4K PQ/HLG physical displays | PASS | 0; physical-app-aOudQb/report.json, 6 cases / 120 picture-coded seeks; first AeEaiq fullscreen pointer timeout retained, harness corrected actual point hit-test before ordinary click |
| candidate mDCV screenshot | PASS | 0; physical-app-YYMwQn/report.json; actual 16-bit screenshot publication after the original rejection was fixed |
| prepare schema-2 current proof / portable build / folder ZIP | PASS | 0 each; desktop-release-inputs.json, final-hdr-portable-build.log, final-hdr-folder-build.log |
| final app payload compared to tested candidate | PASS | 0; release-evidence artifact check; inner EXE 5badc7f2d2bbf8a4ebf4af13169cbd8f809863069e3b4296fafecd0cabc2f443, ASAR 56ce276870525e7aeb359092b338ff8763386be8ddff7f3bf2de5c2c870c74b1 |
| every final ZIP member equals tested payload | PASS | 0; candidate ZIP-BYTE-AUDIT.json, all 679 file hashes checked |
| actual final folder ZIP migration / three startups / exits | PASS | 0; folder-release-test-ANt0Qi/startup-timings.json; final-folder-product-test.log |
| actual final single EXE migration / three startups / exits | PASS | 0; portable-release-test-McKqnN/startup-timings.json; final-exe-product-test.log |
| actual extracted ZIP 4K PQ / HLG, opt-in coordinator | PASS | 0; physical-app-vB2lXL/report.json; 6 cases, 120 actual picture-coded seeks, fullscreen/minimize/restore/source-load and resource-release assertions |
| actual extracted ZIP mDCV PNG byte publication | PASS | 0; physical-app-BGOkFD/report.json and candidate HDR-PNG-BYTE-AUDIT.json; all 3 saved PNGs equal native screenshot bytes, 16-bit with mDCV/cICP and valid chunk CRCs |
| actual extracted ZIP native-to-Chromium original handoff | PASS | 0; render-app-flow-X3ZvaK/report.json; frame/position/pause preserved, original file path, preference unchanged, no surviving host/texture/source leases |

Log basenames above reside in build/physical-display-acceptance-b13d2zrp.
Source materials contain 22 native archives, 3 native support packages and 11
controlled CLI archives, original recipes/licenses, current application source,
exact generated build metadata and separate actual/latest backend replay records.
Every indexed source member is hash checked. The final source ZIP and external
receipt/SHA256SUMS bind the assets; earlier material ZIPs remain validation history.
The first material assembly failed because the then-latest frontend replay lacked
its backend receipt. That missing backend build was performed and verified; no
receipt or hash check was skipped. An auxiliary PNG audit first hit Python's
local GBK default while reading a UTF-8 report; explicit UTF-8 corrected that
analysis command, without changing application files or image data.

Startup observations are not controlled cold-boot benchmarks: folder library-ready
about 0.8–2.1 seconds, single EXE about 12.1–12.5 seconds including extraction,
under concurrent local validation. These tests use synthetic legacy library data
and a generated H264 clip, not a real user's backup. Manual update interaction
uses an explicitly mocked GitHub response; no live update/publication claim.
The bounded 60-second concurrency result from the prior build is historical,
not a new long-duration test of this build. Physical HDR tests cover synthetic
PQ/HLG code charts and current display state, not mastered-film quality,
colorimeter accuracy, Dolby Vision or dynamic metadata. No playback whitelist.

Stage conclusions: A PASS locally / hosted CI unrun; B PASS scoped default-off
coordinator only (full three-owner migration not claimed); C PASS unchanged
selection/quality defaults; D prior measured result retained without speculative
FFmpeg changes; E PASS current local rebuild, external device user-deferred.
PublicationReady remains false. Final hashes and selected artifact paths are in
CANDIDATE-ACCEPTANCE.json and SHA256SUMS.txt beside the new local artifacts.


## Current close-out work: test stability → long soak → coordinator expansion

| Item | Status | Actual evidence |
| --- | --- | --- |
| reproduce conflicting independent pointer input | PASS diagnostic, test failure retained | exit 1; native-independent-ysRkYO/hover-trace.json, native pointer changes after fullscreen while layout stays fixed |
| isolated protocol-input independent flow | PASS three consecutive runs | exit 0; native-independent-8CgsR6, dtaRcT, wHwzAa; isolated-hover-1/2/3.log; no production option change, not physical pointer certification |
| repeated actual fullscreen hit-test / DPI flow | PASS two consecutive runs | exit 0; physical-app-GvdhBH and lvQYbK/report.json; fullscreen-hit-test-1/2.log |
| baseline packaged 20-minute library concurrency | PASS | exit 0; architecture-library-20min.log / architecture-library-20min-exit.json; desktop-usage-avhub-desktop-usage-RiVp6o/soak.json; completed and clean exit |
| baseline packaged 10-minute 4K native soak | PASS | exit 0; architecture-render-10min.log / architecture-render-10min-exit.json; render-app-soak-9Ebcg1/report.json; completed, resource convergence and actual cleanup assertions |
| coordinator expansion | PASS scoped source increment | default-off independent adapter added alongside D3D11 adapter; actual tests below; full Chromium owner migration is not claimed |

Log basenames above are under build/physical-display-acceptance-b13d2zrp.
No new application package, version bump or Git mutation is part of this work.

## Close-out source checkpoint: 2026-10-31

Current source build **f681953d4f3c5bae**, version 0.2.17, frontend built at
2026-10-31T14:13:21.500Z; Electron compilation subsequently passed (exit 0).
HEAD remains 9e734f3a7a228e9af1516fdcbeb14174d5ea29ac. This is a dirty source
checkpoint, not a release commit. The earlier EXE/ZIP/source-material hashes
remain historical baseline evidence and do not contain this new adapter.

| Check | Result | Exit / evidence |
| --- | --- | --- |
| frontend / Electron compilation | PASS | 0; closeout-final-build.log and actual npm run build:electron command |
| dependency audit | PASS | 0; closeout-audit.log; npm audit --audit-level=high reports 0 vulnerabilities |
| adapter, native pause boundary and coordinator contracts | PASS | 0; closeout-contracts-final.log; 24 tests; fake IPC/owners explicitly are not native display acceptance |
| existing MPV client / independent / legacy coordination | PASS | 0 each; mpv-client.mjs, independent-coordination.mjs, native-coordination.mjs; guaranteed source-memory fixture corrected in independent test |
| settings / Chromium delivery / lifecycle renderer harness | PASS | 0; closeout-renderer-final.log; 15 tests; browser component/decoder harness only |
| actual source Electron, opt-in handoff and rapid Back | PASS | 0; session-handoff-app-hY8ISU/report.json; closeout-handoff-app-final.log; four paused source-frame/screenshot/return comparisons across both native modes, open then immediate Back |
| actual source Electron, switch OFF / old path | PASS after harness correction | 0; session-handoff-app-kPH98f/report.json; closeout-handoff-disabled-v2.log; same four handoffs and rapid Back; no coordinator phase published |
| opt-in independent full UI / persistence recovery | PASS | 0; native-independent-xldgUh/acceptance.json; closeout-independent-coordinated.log; real native controls, queue, screenshot, seek, injected save failure/retry, confirmed discard, application quit/source identity |
| opt-in D3D11 full application flow | PASS | 0; render-app-flow-qkluBg/report.json; closeout-render-source.log; decoded/compositor target checks, fullscreen, screenshot, zoom/rotation, native host exit, all 61 imports released |
| whitespace and user planning document | PASS | 0; git diff --check (line-ending warnings only); plan SHA256 unchanged 754825c38768ed197177696883545f47da70102ae03a7340c130fa0b8ed23ae3 |
| external physical device, this source checkpoint | SKIP user-deferred | no substituted earlier-device result |
| long soak of this new source checkpoint | SKIP this increment | the completed 30-minute soak below belongs to baseline build 3f5396166505433f, not f681953d4f3c5bae |
| new package / hosted CI / publication | SKIP not requested | no new package, commit, push, tag or release |

The completed baseline library run lasted about 1,211 seconds with 192 generated
320x180 H264 files, 112 cycles, 336 preview actions and 19 actual screenshots.
It observed 5,414 active decoded frames, zero active dropped frames, waiting
events or unexpected source reloads. Sampled Electron working sets varied with
workload (approximately 557–937 MiB); this does not certify leak-free behavior
or real large-file/HDR performance. The subsequent 600-second native run used
generated 4K25 SDR10 content on a 960-second repeated-content timeline: zero
reported decoder/VO drops, 15,790 GPU imports and 15,790 releases, host exited,
source read lease released, resource growth/convergence bounds passed. Protocol
pipe I/O is not physical disk throughput; compositor samples are not physical
scanout or colorimeter proof.

Retained failures: session-handoff-app-A76XAt exit 1 was a harness read before
the default path finished native open (body still preparing; desktop log shows
open after the test began shutdown). Wait for the existing real UI readiness
before snapshot polling; no product timing/visibility change was used. Earlier
session-handoff-app-XRwjaV lacked the owned screenshot folder; 6G1I2U reloaded
before Back completed. Their corrected actual run hW7z77 passed before the final
rapid-cancel addition; hY8ISU passes that addition. Renderer failures retained in
closeout-renderer-tests.log / closeout-session-ui-v2.log concerned an incomplete
mock bridge and synchronous checkbox assertions against asynchronous persistence;
the final harness awaits real controlled state. No failing record is relabelled.

IndependentSessionAdapter uses actual native session/media/revision boundaries,
decoded readiness, seek restart/target completion and authoritative native close.
The existing main process remains the only native process/read-lease/durable-save
owner; native controls keep using the existing MpvClient queue. Default engine,
UI layout, original-file delivery and conversion permissions are unchanged.
Explicit paused opens now propagate to the native startup and do not issue an
unpause command. Both opt-in and opt-out real application handoffs verify this.

Scope: independent MPV and D3D11 now have opt-in coordinator adapters. Chromium
still uses the existing Player/Html5Delivery owner and explicit handoff barriers;
a root coordinator spanning React engine mounts has NOT been completed. Keep
the flag default-off. Next increment: integrate the Chromium owner without
duplicating its decoded readiness/progress writer, then repeat source long-soak
and packaged verification when packaging is authorized. PublicationReady=false.

## 2026-11-01 Chromium increment: frozen source 077cbfa55b67408d

No commit/push/tag/package/version change yet. User permits a stable push only
if warranted after verification; earlier package 3f5396166505433f is not current
source acceptance. Exact changes and ownership scope are described in document 69.

| Check | Result | Exit / current evidence |
| --- | --- | --- |
| frontend / Electron frozen compilation | PASS | 0 each; architecture-closeout-20261101/build-frozen.log, Electron command; build 077cbfa55b67408d, 0.2.17 |
| Node owner / safety / build / UI contracts | PASS | 0; node-final.log; 162 tests including 6 new fake-video Chromium owner tests, not real decoder proof |
| render API contracts | PASS | 0; render-contracts.log; 49 tests, not GPU acceptance |
| actual source Electron three-path handoff, flag on | PASS | 0; handoff-frozen.log; session-handoff-app-jeDiV5/report.json; four framecoded pause/screenshot/return checks plus rapid open/Back |
| actual source Electron same handoffs, flag off | PASS | 0; handoff-off-frozen.log; session-handoff-app-ZJq61L/report.json |
| marked component/decoder harnesses | PASS | 0; renderer-frozen.log; 20 tests, including direct/indexed TS/indexed remux latest seek and original URL preservation, source progress, injected save failure/retry, default-off/global setting semantics |
| affected persistence / settings / exit renderer harnesses | PASS | 0; related-renderer.log; 67 further tests; progress failure, subtitle memory, native launch, quality permissions, settings across light/dark/narrow windows, shutdown/cancel |
| npm audit moderate gate | PASS | 0; audit.log; zero vulnerabilities; lockfile unchanged this continuation |
| full isolated backend | PASS with two explicit SKIPs | 0; backend-final.log / backend-final-exit.json, build/backend-tests/normal.json; 785 run in 199.008s, 2 link-privilege skips; no disabled checks |
| frozen source library concurrency | PASS bounded workload; measured drops retained | 0; library-frozen-soak.log / library-frozen-soak-exit.json; desktop-usage-avhub-desktop-usage-BvMjRO/soak.json; 1,203.377s, opt-in coordinator, real Electron, 192 owned files, clean exit/source unchanged |
| frozen source 4K coordinator native soak | PASS bounded convergence policy; raw range exception retained | 0; render-app-soak-QkhEKa/report.json; render-frozen-soak.log / render-frozen-soak-exit.json; 600.068s, zero decoder/VO drops, real compositor samples, actual cleanup |
| latest new package / source replay / hosted CI | SKIP not yet performed | no newly tested distributable or hosted green run; publication decision remains pending |
| rejection of stale package receipt against current source | PASS negative gate | expected exit 1; stale-package-gate.log; old build 3f5396166505433f cannot certify current 077cbfa55b67408d; no hash/evidence check bypass |

Backend initial restricted run blocked before application restore code: the
30-second faulthandler probe shows Windows asyncio creating its local socketpair
in socket.accept, not an application DB lock. Same isolated restore test passes
in 0.222s with localhost socket permission (probe log exit 0); full suite then
passes in the same permitted environment. Original process was stopped only
after its exact test PID/path/command was verified; original exit -1, preserved
backend-restricted.log and backend.log. No backup source fix or timeout bypass.
The first probe has exit 1 with its actual stack. The backend JSON was UTF-8;
an auxiliary inspection first used Windows GBK and failed, then explicitly read
UTF-8; no test report/image/product bytes were altered.

Retained incomplete soaks: desktop-usage-avhub-desktop-usage-MJuiCF (build
bb2579d9e90aa986) was normally closed to add controller disposal; exit 1 with
closed-page evidence. desktop-usage-avhub-desktop-usage-iKNgHv (0c3747db3687dc3c)
was stopped via its explicit owned stop marker to finish failure-path retirement;
exit 1 / Incomplete workload is not acceptance, clean exit separately recorded.
Neither is a completed long-test PASS. Initial TS build exit 1 (nullable request)
was corrected using already captured currentRequest. Pure-contract first compile
pulled Hls.js into Node16 test compilation; replaced concrete engine type with a
structural typed port, no runtime substitution. Cancellation assertion initially
expected AbortError; the coordinator correctly classifies it as kind=cancelled.
All original failed logs are retained beside corrected outputs.

Source quality/defaults remain unchanged. Native and Chromium use one existing
durable writer per owner, not parallel new persistence implementations. Current
increment adds real Chromium ownership/first-frame/seek/save/retirement to the
same coordinator class. A single shared root coordinator across React engine
mounts remains a separate increment; do not claim it is implemented or default
enabled. No external-computer result was inferred; user deferred that testing.

Frozen library run completed 110 cycles / 330 preview actions / 19 actual C
screenshots, 5,397 measured active frames with **2 active dropped frames** (about
0.037%), zero measured waiting events or unexpected source reloads. This is not
zero-drop certification. Sampled summed Electron working sets ranged 546.3–959.2
MiB; no leak-free/VRAM claim. Generated 320x180 12fps H264 library is not real-media
4K/HDR/long-GOP proof. Early in the workload, other marked component regression
processes also ran locally; timings are not isolated performance benchmarks.

Click-to-library-DOM median 52.2ms, maximum 1,493.1ms. The longest cycle's explicit
save shows 709.380ms DB lock wait and 736.751ms commit (HTTP about 1,448ms), with
no recorded renderer long task. Observing cover-publish at queue entry is not
proof it caused the entire wait. The existing durable-commit tail remains a
follow-up measurement item; no weaker SQLite durability, early navigation or
loading-indicator suppression was used. Preserve this raw tail, do not describe
all navigation as instantaneous or attribute it to MPV decoding.

Native frozen-source run: generated 4K25 SDR10 repeated-content fixture, 600.068s
measured after the existing fixed warmup; real compositor frame-code/wall-clock
ratio 1.000031696. Both decoder and VO drop increases are 0. GPU imports/releases
15,789/15,789; helper exited, source lease released, timer requests/releases 2/2,
owned media copy hash/mtime unchanged before owned-copy removal. Subject payload
SHA256 **415b814f84b7d7fd551dff60b482dd4cd3c3ec5c5522f176a0822eff045b5723**
matches both frozen handoff reports and final compiled-payload recomputation.
No physical scanout, colorimeter, mastered HDR or all-codec claim.

Do not erase the raw resource exception: rawRangePassed=false, late native handle
range 17 and GPU range 69,140,480 bytes. Under the already established convergence
policy, peak positive handle growth was 9, settled positive growth 0, idle range
0; native private settled growth 1,519,616 bytes; GPU peak/settled positive growth
0. Those existing convergence assertions passed without any threshold change.
Late summed Electron private range 68,248 KiB is within the existing 256 MiB
limit. A bounded convergence PASS is not proof of zero allocation churn or leak
freedom. Auxiliary final-report inspection again required explicit UTF-8 on this
GBK host; the actual report bytes and test exit 0 were unaffected.

### Current decision after this increment

Local source implementation and bounded acceptance PASS at the scope above.
Keep the coordinator default-off. Actual per-owner integration now covers all
three paths; a single cross-mount root owner is still not implemented, and no
current-source EXE/ZIP/source replay or current-commit hosted CI green run exists.
The old receipt is correctly rejected by the current-build gate. Therefore
**PublicationReady=false; no stable tag, version bump, commit, push or upload**.
User-deferred external testing remains SKIP, not the sole reason for this decision.
Next work is root-lifetime consolidation / source close-out followed by matching
local distributable, source-material and hosted CI evidence before a stable push;
do not reuse the old 3f5396166505433f package or weaken commit/hash/audit checks.

## Root ownership source checkpoint 7db3a3b77514122b

This supersedes the previous "root owner unimplemented" status for source only.
Application version remains 0.2.17 during the authorized ordinary source push.
Root implementation and its precise explicit-handoff scope are in document 69.

| Check | Result | Exit / evidence under build/root-session-closeout unless otherwise stated |
| --- | --- | --- |
| source frontend / Electron compile | PASS | 0 each; build-initial.log and actual Electron compile |
| root and existing owner contracts | PASS | 0; root-contracts.log; 20 coordinator tests including 6 new scoped root cases; fake owner proof only |
| all Node / render contract files | PASS | 0; all-contracts.log; 217 tests |
| actual Electron shared root / increasing generation / different-media remount | PASS | 0; handoff-initial.log; build/session-handoff-app-69JHEy/report.json; 4 rounds, both native modes, paused original-source frame and screenshot, source unchanged, rapid open/Back |
| actual independent full flow with coordinator | PASS | 0; independent-flow.log; build/native-independent-rZ9hqM/acceptance.json; injected native protocol controls, not physical OS input |
| actual D3D11 full flow with coordinator | PASS | 0; render-flow.log; build/render-app-flow-341YSs/report.json; compositor/target/transform/fullscreen/capture/cleanup |
| component/decoder regressions | PASS | 0; renderer-initial.log; 23 tests including defaults, source continuity, failed saves and shutdown |
| fresh npm ci / moderate audit after source close-out | PASS | 0 each; fresh-ci.log / fresh-audit.log; normal lifecycle, 0 vulnerabilities; Electron installed explicitly, no allowScripts policy bypass |
| rebuild after fresh install, identical frozen payload | PASS | 0; fresh-build.log, Electron compile; d50dc1f5e9c206b651734c8db9abafd869d260f8e181a6f825e24fc283011090 matches actual handoff subject |
| latest root source long soak / exact packaged product | PENDING | prior 077cbfa55b67408d results remain historical, not this build |
| matching hosted CI | PENDING | source push authorized conditionally as part of release validation; not a stable tag or publish |

ReleaseValidationWarranted=true, PublicationReady=false. A source push does not
change the version or authorize a stable tag before gates pass. Preserve all
earlier failed/interrupted evidence and the measured durable-save tail. No new
lossy path, quality limit, native dependency or runtime hash override was added.

Fresh npm install reports one unapproved optional electron-winstaller lifecycle
script under this npm host policy; no blanket approval/ignore-scripts workaround
was used. Normal project postinstall ran its exact-version/hash-checked temp
adaptation; compiled frontend/Electron payload remains byte-identical. Native
rendering and original media formats were not changed. User root plan remains
SHA256 754825c38768ed197177696883545f47da70102ae03a7340c130fa0b8ed23ae3.
