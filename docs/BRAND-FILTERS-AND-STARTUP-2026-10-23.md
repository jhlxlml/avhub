# Desktop brand, advanced filters and startup observation

## Scope and safety

- Electron desktop only. No packaging, publishing, tag or version change.
- No writes to `E:\downloads`; all media workloads use owned generated samples and isolated profiles.
- Playback quality, codecs and conversion permissions are unchanged.

## Brand

`frontend/public/avhub.svg` is now the single brand source: the About mark's indigo rounded square and white rounded play glyph. About, library branding, window title bar and native-player overlay reference this source. `scripts/prepare-app-icon.py` exports the PNG and seven ICO sizes; `electron/assets/icon-manifest.json` records source and output hashes. The existing Windows packaging configuration uses this ICO and the desktop window uses the PNG.

The local service has an explicit SVG route. A general frontend fallback must not answer this request with HTML. Route MIME, file identity and real decoded-image assertions cover the regression. SVG rasterization dependencies are regeneration-only, not application runtime requirements.

Existing EXEs are not rewritten by a source iteration. A future authorized package incorporates these assets; Windows may separately retain cached icons for old shortcuts.

## Advanced filters

- Consistent 32px select controls and filter chips; transparent resting borders, quiet surfaces and matching icon/label alignment.
- Dark/light and 390px/1440px renderer harnesses check geometry, image loading, overflow and keyboard focus. Keyboard focus indicators remain visible.
- Actual Electron acceptance also covers wide/compact filters, settings groups, directory errors and task feedback.
- Search/filter/query behavior is unchanged.

## Startup investigation

The intermittent startup timeout remains unproven and is not declared fixed. Added passive stage labels distinguish renderer entry, service verification, preferences, roots, initial library readiness and failures. Only whitelisted labels from the trusted main renderer are accepted; source paths, titles and arbitrary error strings are not sent by this diagnostic channel.

A 15-second observation timer records the last stage and document-loading state. It does not reload, retry, extend startup deadlines or conceal failure. Renderer termination/unresponsiveness and document-load rejection have explicit log events.

Twenty real Electron starts passed in `build/electron-startup-restarts-DzD9qE/acceptance.json`, including five exits during directory discovery. Observed readiness was about 0.85–1.35 seconds. This is not cold-OS or packaged-EXE timing. The earlier timeout was not reproduced, so a future `startup-slow` event and its stage evidence are still needed to establish the root cause.

After the explicit SVG route fix, another 20 starts on final build `83e638bf3a46962a` passed in `build/electron-startup-restarts-qFnaAt/acceptance.json`, including five discovery-time exits. Readiness was about 0.87–1.28 seconds. Forty repeated starts across the two builds passed in total; the rare timeout remains unresolved.

## Verification

- Canonical icon provenance, seven ICO layers, native PNG and development/packaged resource path simulation: passed using real Electron; no EXE packaged.
- Startup trace unit regression: passed.
- Brand/filter renderer harness: four theme/width combinations passed.
- Combined brand, filters, borderless controls, Help and library interaction renderer harness: 21 passed.
- Actual Electron refinement: passed; artifacts `build/electron-library-refinement-8MkmPC`.
- CI policy tests: 11 passed. Desktop policy tests: 3 passed.
- CI now includes canonical icon/filter regression and repeated real Electron startup; this is a source workflow change, not evidence of a cloud run.

## Authorized concurrent usage acceptance

Report: `build/desktop-usage-avhub-desktop-usage-VHeGcU/soak.json`; build `83e638bf3a46962a`.

- Requested 1,200 seconds; measured workload 1,210.10 seconds, 107 completed cycles, 321 decoded hover previews over a 600-video generated library. Incremental discovery and thumbnail retries increased the workload during the run.
- Completed, clean exit, source hash/mtime/size unchanged, no script errors. No unexpected active-source reloads, no stalled events, one waiting event.
- Measured playing intervals: 5,107 decoded frames and 106 dropped frames. This is not a zero-drop or zero-buffering claim.
- Return-to-library latency: median 148ms, p95 175ms, max 198ms.
- Sampled renderer working-set peak 480.1 MiB; first/last ten-cycle medians 246.9/462.7 MiB. GPU-process working-set peak 589.7 MiB; corresponding medians 471.5/492.5 MiB. GPU process RAM is not VRAM. The renderer increase warrants a longer same-page/return-to-baseline allocation analysis; this bounded run cannot prove or disprove a leak.
- WAL peak 4,206,552 bytes, after exit 0. Background playback/data maintenance recorded 124 attempts each with no failures. Read transactions: 13,910, none classified slow, max total 94.687ms. Serialized transactions: 2,036, five classified slow. Worst progress-save commit 642.501ms (total 644.620ms), committed successfully; commit tail remains observable rather than declared eliminated.
- A separate headless renderer regression ran briefly during this workload; figures are concurrent acceptance measurements, not an isolated performance benchmark.

Generated 320×180 SDR samples cannot establish real 4K/HDR decoding performance or resolve the deferred problem video. Actual EXE packaging/cold startup was not performed.

## Follow-up priorities

1. Compare renderer allocations and decoded-image/video resource retention under repeated same-page and alternating-page cycles, including an idle return-to-baseline interval. Do not infer a leak solely from working set or disable previews to obtain a lower number.
2. Continue passive startup-stage collection if the rare timeout recurs; repeated successful launches are not a root-cause fix.
3. Correlate progress-save commit tails with background publication/checkpoint timing before selecting a database change. Preserve durable saves and original playback quality.
