# AVHub development principles

- Keep `archive/web-legacy-2026-10-05/` as a frozen source snapshot. The archive-only request does not change the main project's supported runtimes, launch commands or development policy. Do not include archived sources in application packages.
- Preserve original playback quality in every optimization. Prefer native original-file playback; when container conversion is needed, use stream-copy wherever supported. Do not silently re-encode video or audio, downscale, reduce bit depth, change color information, or tone-map HDR to SDR.
- Lossy compatibility playback is an explicitly confirmed exception, not a performance optimization or automatic fallback. Keep API conversion permissions disabled by default and explain the loss. Returning to original quality must revoke those permissions.
- Original media is read-only. Never modify, rename, move, or delete source videos. `E:\downloads` is authorized for read-only validation only. Generated derivatives belong in application-owned caches with ownership checks, source invalidation, capacity/free-space limits, cancellation, and protection for active readers/playback.
- Measure real decoded frames, target accuracy, source reloads, buffering and I/O. Hiding a loading indicator or retaining a previous frame is not evidence of faster seeking. State codec/sample/browser limitations and distinguish synthetic tests from real-media results.
- During iteration, do not package or publish unless the user requests it. Preserve unrelated working-tree changes and user-provided planning documents.
