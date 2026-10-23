# Directory controls and settings alignment

Build: `8357623cdfdcaf14`. Local iteration only: no package, release, tag, version bump or original-media mutation.

## Changes

- Removed the single-item directory overflow menu. A quiet X button now sits immediately to the right of Scan, with the same size. Its accessible name is “移出媒体库 …”; tooltip and confirmation explain that original files are not deleted. Cancellation restores focus without a queued callback stealing a later selection.
- Permission reads use directory IDs/paths as their dependency identity rather than the roots array object. An unchanged list refresh no longer clears already loaded permissions. Obsolete read results/errors cannot replace a newer permission mutation.
- Permission confirmation and directory removal acquire a synchronous action guard before awaiting. The settings busy state covers permission confirmation too, preventing overlapping actions. Permission updates use the latest loaded grant and require an explicit successful desktop response; a missing/failed result is not displayed as saved.
- Data-folder actions share a responsive equal-width grid. Desktop shows Open, Copy and Customize together; narrow layouts wrap consistently. File-status Refresh aligns with the select rather than its label, with matching 32px control heights and quiet resting surfaces.

The old overflow focus/dismissal path is no longer involved in directory removal. These changes address observable race opportunities; the user's original intermittent no-response was not independently captured before modification, so no unique root cause is asserted.

## Verification

- TypeScript/frontend and Electron builds passed.
- Directory renderer harness: 17 passed, including confirmation cancellation/focus, permissions read errors/retry, unsuccessful save/retry/disable, dark/light 390px/1440px data layouts and long paths. This is a component harness, not native desktop acceptance.
- Related borderless-control and thumbnail-task harnesses: 5 passed.
- CI policy regression: 11 passed.
- Actual Electron: `build/avhub-directory-controls-QmQOG0/acceptance.json`, completed with no script errors. Six removal cancellations (including Escape), nine permission cycles (three grant types × three cancellation/enable/disable repetitions), and three remove/re-add cycles passed. Only owned TEMP directories were authorized; the sentinel file and directory contents remained unchanged. Native desktop data controls passed geometry assertions. The isolated environment intentionally locks Customize via AVHUB_DATA_DIR; enabled layout is also covered by the renderer harness.
- The new actual desktop directory test is included in CI; no cloud run was started.

All playback, codec, conversion and source-quality policies remain unchanged. `E:\downloads` was not written or used for mutation testing.
