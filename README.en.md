# AVHub

English · [简体中文](README.md)

### 0.2.7 update

- Fixes CI fixture inconsistencies with Windows 8.3 path aliases and adds a real short-path regression. Registration resolves once; large root lookup remains disk-free. Full regressions pass with both normal and short temporary paths.

### 0.2.6 update

- Adds GitHub Actions: regular commits run tests, stable version tags build and publish Windows portable releases with checksums/provenance. Manual Actions runs build artifacts only. See [workflow guide](docs/GITHUB-ACTIONS.md).

### 0.2.5 update

- Electron desktop is the only supported product. `npm run dev` and the batch launcher open the desktop window; native operations use Electron only.
- React, FastAPI and localhost playback remain internals. Browser component/decoder harnesses are explicitly marked tests, not a supported browser edition. The archive stays frozen and excluded from packages.

### 0.2.4 update

- Cover-wall favorite buttons appear on hover or keyboard focus, matching playlist actions. Favorite changes update in place without remounting images/previews, while favorite views and pagination remain accurate.

### 0.2.3 update

- Added an explicit manual update button beside the About version. No background checks, automatic downloads or installation. See [release notes](docs/RELEASE-0.2.3.md).

### 0.2.2 update

- The directory sidebar starts collapsed. Open it from the toolbar folder icon; reloads and new launches collapse it without changing directory filters.

### 0.2.1 update

- Added a collapsible multi-level directory sidebar with lazy expansion, per-level pagination, video counts, keyboard navigation, and deep-link reveal. It uses indexed directories and adapts to narrow windows.
- Added persistent sort field/direction (date added by default), separate resolution filters, consistent badges, and an About settings page.
- Data defaults to `AVHub-data`; desktop users can choose an empty custom directory and migrate on the next launch while retaining the original library.

AVHub is an offline local video library and player for Windows. It brings multiple video directories into one interface, lets you browse by folder or by movie and series, and remembers favorites, playlists, and viewing progress.

Videos stay in their original locations. The app does not offer operations to move, rename, or delete source videos. Indexes, artwork, settings, and viewing records are stored separately. Once dependencies are installed or a portable build is ready, everyday scanning and playback work offline, without online artwork or metadata scraping.

The main project supports **Electron desktop only**, with always-on-top, adaptive borderless Pure Playback and native folder operations. React, FastAPI and localhost delivery are internal architecture, not a standalone browser product.

The historical [browser source snapshot](archive/web-legacy-2026-10-05/ARCHIVE.md) stays frozen, unmaintained and excluded from desktop packages.

**The application UI is currently Chinese.** This English README does not imply English UI support. The repository primarily contains source code, not FFmpeg executables, generated web assets, personal library data, or portable EXEs.

## Features

Recent library conveniences are implemented natively for AVHub: Electron-owned folder dialogs with separate persistent media/screenshot histories; three opening-position policies (ask by default, resume, restart); pixel-count and file-size sorting with unknown values last; file sizes on video cards; existing data-folder viewing/opening/copying without changing its location; and an About panel using the AVHub identity, version/build metadata, and a restricted project-homepage action. Watched videos start at zero during automatic continuation too. These features do not modify or re-encode source videos.

### Library

- Multiple local directories, added through a native folder picker or a typed path; per-directory scans, incremental library refresh, and interrupted-scan recovery.
- Grid, list, and folder browsing; all videos, movies, series, continue watching, favorites, history, and playlists.
- Playlists pair a cover summary with horizontal video rows, with search, reordering, renaming, ordered or random starts, bounded pagination, and dark/light and narrow-window layouts.
- Search titles, filenames, and tags; filter and sort by directory, format, duration, and watched status.
- Infer series, seasons, and episodes from local names and folders; manually edit titles, types, episode numbers, tags, and ratings.
- Generate artwork from video frames, import custom artwork, capture a cover at a chosen video position, and batch-edit metadata.
- Server-side pagination and on-demand directory / series data. An independent thumbnail queue supports pause and resume and yields to playback.
- Relocate unavailable directories while retaining associated user metadata. Removing a library directory does not delete its videos.

### Player

- Default to original-file playback or lossless remuxing, never automatic quality reduction; lossy compatibility playback requires confirmation.
- Resume playback, seeking, volume, playback speed, audio-track selection, text subtitles, subtitle delay, and technical information.
- Same-series, same-folder and playlist queues with sequential playback, shuffle and repeat-one. Settings → Playback preferences → Video autoplay lets you enable or disable automatic continuation.
- Video fullscreen, picture-in-picture, and Pure Playback; desktop always-on-top is an independent switch.
- Rotation, pointer-centered wheel zoom, dragging a zoomed image, and one-click view reset.
- One-click PNG screenshots with a configurable destination, no save dialog, and no interruption of the current playback state.
- Keyboard actions do not reveal already-hidden controls; text inputs, menus, and settings are protected from playback shortcuts.

### Data and diagnostics

- SQLite persistence for indexes, favorites, tags, playlists, progress, and preferences.
- Database backup and full-library backup / restore, including custom artwork and optionally thumbnails.
- Storage previews and cache cleanup, scan and artwork task status, playback diagnostics, and desktop logs.
- Loopback-only service and request validation; the desktop app adds session validation and restricted native operations.

## Use an existing portable build

If you already have a portable EXE built from this project, put it in a writable directory and double-click it to start desktop mode. Python, Node.js, and FFmpeg do not need separate installation. The first launch may take time to extract the app and start the local service.

The library defaults to `AVHub-data/` beside the EXE. Do not delete it as if it were temporary cache. Follow “First use” below to add video directories. The source repository itself does not include this EXE.

## Run from source

Run the following commands in PowerShell from the project root. Initial dependency installation needs internet access; everyday use can be offline afterward.

### 1. Prerequisites

| Dependency | Requirement |
| --- | --- |
| OS | Windows; the portable desktop build targets x64 |
| Python | 3.10 or newer; the current local validation environment uses 3.13 |
| Node.js | 22.12 or newer, satisfying the currently locked frontend and Electron dependencies |
| FFmpeg / FFprobe | Windows executables in the project `bin/` directory or on PATH |
| Rendering engine | Chromium is bundled; Edge is needed only for UI component tests |
| PowerShell 7 | Required for the current Windows packaging script, not for ordinary startup |

If you do not already have the source:

```powershell
git clone https://github.com/jhlxlml/avhub.git
cd avhub
```

The app prefers `bin/ffmpeg.exe` and `bin/ffprobe.exe`, falling back to PATH. A build used for compatibility transcoding should support H.264 / AAC; HDR tone mapping also requires the relevant `zscale` / `tonemap` filters.

**For packaging, both executables must be in `bin/`; PATH alone is insufficient.** Keep `bin/FFmpeg-LICENSE.txt` and `bin/FFmpeg-BUILD-INFO.txt` consistent with the actual FFmpeg build you use.

### 2. Install dependencies

A virtual environment is recommended:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in the current terminal, then activate again. This changes the policy only for the current process.

Use `npm ci` to install from `package-lock.json` rather than unintentionally upgrading dependencies. Subsequent Python, test, and packaging commands should use the same Python environment.

### 3. Start desktop mode

```powershell
npm run electron:dev
```

This builds the web UI and Electron main process, then opens the desktop window. Electron manages the local backend and chooses an available port; do not start a separate `run.py` server for this mode.

If Electron cannot locate the intended Python interpreter, set it explicitly in the current terminal:

```powershell
$env:AVHUB_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
npm run electron:dev
```

### 4. Unified desktop launcher

```powershell
npm run dev
```

After installing dependencies, [启动AVHub.bat](启动AVHub.bat) builds and opens the same desktop app. `npm run electron:dev` remains an alias. `run.py` is an internal backend/migration entry; it never opens a browser. Do not launch a separate localhost page.

## First use

1. Open Settings → **媒体目录** (Media directories). Choose “浏览本地文件夹” (Browse local folder), or enter a path and add it. Multiple directories are supported.
2. Click “刷新媒体库” (Refresh library) in the top bar, or “扫描此目录” (Scan this directory) in Settings. Adding a directory does not itself complete a scan.
3. Indexed videos appear progressively, while artwork continues generating in the background. A slow first scan or incomplete artwork is not necessarily a scan failure.
4. Browse through top-level categories, directory filters, or the folder browser. The series view groups episodes by series and season; edit incorrect classifications manually.
5. Open a video, organize favorites and playlists, and return through “继续观看” (Continue watching). Playback progress is saved automatically.
6. If a directory moves, a drive letter changes, or a disk goes offline, check its status under Media directories. Use “重新定位” (Relocate) when needed, then refresh the index.

Check the active data directory under Settings → **运行诊断** (Runtime diagnostics). If desktop shutdown reports unsaved data, retry or cancel as prompted. Forced termination or power loss may discard uncommitted changes.

## Appearance and cover size

- Use the sun / moon icon in the top bar to switch between light and dark mode. The player header provides the same toggle. Dark remains the default. Transparent controls and popovers over video retain dark, high-contrast styling without altering video colors.
- Click the cover-size icon beside the grid / list switch. Use the slider or preset buttons to choose **Compact, Standard, Comfortable, or Large**. Standard preserves the previous layout; column counts adapt to window width.
- Sizing applies to ordinary video grids and grouped-series covers, not list rows, individual episode rows, or playback queues. The control is disabled in list mode and retains its selection when returning to the grid.
- Both preferences are stored in the current library's SQLite database, survive restarts and changing Electron ports, and are included in library backups.

These are display-only settings. They do not change query results, filters, sorting, page size, playback quality, or regenerate artwork. Compact mode may bring more lazy-loaded images into view; larger covers make pages taller and may reveal limited thumbnail resolution. Pagination limits and single-video hover previews remain in place; resizing does not load the entire library.

## Playback and picture quality

Settings → **播放偏好** (Playback preferences) → **视频连播** (Video autoplay) enables or disables automatic continuation and selects sequential, shuffle, or repeat-one. The default scope is the same series in season/episode order; unclassified videos fall back to the exact current folder, excluding subfolders. You can explicitly select same-folder scope. Opening from a playlist uses that playlist and its ordering instead. Shuffle draws from the complete scope, excluding the current and indexed-offline videos; sequential playback stops at the last item.

A cancellable 8-second countdown precedes automatic continuation. Current progress must be saved before switching; a failed save keeps the player on the current item. Automatic continuation resumes unfinished videos and restarts watched videos; manually opening a video retains the resume prompt. Preferences are stored in the local database and shared with the player's queue controls.

An indexed file format is not necessarily a format the browser can decode directly. Supported index extensions are MP4, MKV, AVI, MOV, M4V, WebM, WMV, FLV, TS, MTS, and M2TS. Playback also depends on video and audio codecs, the browser, and the device.

Compatibility determines the playback path:

1. **Direct play**: serves the original file with byte-range requests, without re-encoding.
2. **Lossless remux**: copies video and compatible audio into a browser-playable container; incompatible audio is not silently converted.
3. **Manual compatibility transcode**: produces lossy H.264 HLS only after confirmation. Source-resolution and lower-resolution options are available; neither is lossless. Audio-only compatibility requires separate permission and leaves the video encoding unchanged.

The default original-quality mode never silently re-encodes video/audio, downscales, or maps HDR/high-bit-depth video to SDR/8-bit. If native playback and lossless remuxing fail, playback stops with an explanation. Lossy compatibility options require explicit confirmation; switching back to original quality revokes both conversion permissions. The API also requires explicit `allow_video_transcode` / `allow_audio_transcode` flags for the respective conversion.

Keeping 4K resolution does not mean lossless output. Manually authorized compatibility transcoding is lossy. HDR / high-bit-depth conversion may produce SDR / 8-bit output and cannot retain all original dynamic range or bit depth. Unsupported Dolby Vision conversions are explicitly rejected rather than labeled as original-quality playback.

HEVC direct playback depends on browser, OS, and hardware support. Random seeking in MKV / TS may still require preparation when remuxing or transcoding. AVHub does not integrate MPV or another native playback engine, so native-player decoding and seeking performance cannot be guaranteed for every file.

Compatible H.264 / AAC TS files can use **indexed TS playback**: the first playback builds a keyframe index cached in `data/ts-index/`. Later seeks read original-file ranges on demand while reusing the decoder, without copying or re-encoding the whole video. Initial indexing adds startup time; unusual timelines, nonstandard containers, and audio-track changes retain the compatibility fallback. See the [TS seeking and blank-frame validation report](docs/TS-INDEXED-PLAYBACK-2026-10-04.md) (Chinese).

When remuxing is necessary, compatible H.264 MKV, AVI, MOV, MP4/M4V and FLV files can use **indexed on-demand remuxing**. Seeks prepare only the required keyframe interval without reloading the video source; video encoding and resolution are preserved. Unsupported audio is converted only with separate permission. Indexes live in `data/remux-index/`. Each session targets at most 256MB of fragments, with temporary overruns possible for oversized GOPs or open readers. Original playback remains preferred, and obsolete file reads are cancelled and closed promptly. Unsupported indexes fall back to ordinary lossless remuxing, not video encoding. See the [multi-format seeking validation report](docs/MULTIFORMAT-SEEK-2026-10-04.md) (Chinese).

### Optional lossless MKV preparation

This feature is **off by default**. Enable **Settings → Playback preferences → MKV lossless playback preparation** to expose the video-menu entry and allow prepared-copy playback. It is intended only for expensive container seeks, not guaranteed acceleration for every MKV.

Select **More actions → Lossless playback preparation** to create an optimized MKV copy with rebuilt, front-loaded container indexes, retaining every video/audio/subtitle stream, codec, resolution, bit depth and color information. Original files are read-only. Default-track native playback uses the prepared copy when valid; other audio selections retain the original source path. A failed prepared-source playback retries the original first.

Disabling stops unfinished preparation, hides the menu entry and bypasses existing copies for new playback. Completed copies remain intact and can be reused or cleaned after re-enabling. Original-file playback and on-demand lossless remuxing are unchanged. The switch persists in the library database across restarts.

Copies live in the application data directory's `native-cache/`, with an 8 GB total limit and free-space checks. A copy can be almost as large as its source. Insufficient space results in refusal, never quality reduction. Only verified, unused application-owned copies can be reclaimed; the same dialog supports individual cleanup. Open or paused prepared playback is protected. Source changes invalidate the copy. Progress and cancellation are available; resuming playback interrupts copying, which restarts once idle. Exit stops preparation. The full library is never prepared automatically.

This optimizes container seeking, not decoding compatibility, and does not guarantee faster seeks for every MKV. See the [original-quality and native preparation audit](docs/NATIVE-QUALITY-2026-10-05.md) (Chinese).

Embedded text subtitles and external SRT / VTT / ASS / SSA are supported. ASS / SSA is converted to WebVTT, without guaranteed preservation of complex styling or effects. Image-based subtitles such as PGS / VobSub are not currently supported.

## Keyboard and mouse controls

On the playback page:

| Action | Key |
| --- | --- |
| Play / pause | Space, K |
| Seek backward / forward 10 seconds | J / L |
| Seek backward / forward 5 seconds | ← / → |
| Adjust volume | ↑ / ↓ |
| Mute | M |
| Video fullscreen | F |
| Pure Playback | W |
| Exit Pure Playback | Esc; exit video fullscreen first if active |
| Picture-in-picture | P |
| Save screenshot | **C** |
| Next video | N |
| Rotate image | R |

The mouse wheel zooms around the pointer. Drag the image while zoomed, and use the reset icon to restore the default view. Shift + wheel adjusts volume.

After clicking a playback control, Space still plays or pauses instead of activating that button again. Text fields, open menus, and settings keep their own keyboard behavior.

**Pure Playback** hides library information, adapts the desktop window to the video's aspect ratio, overlays controls and restores the previous window when exiting. Encoded black bars are not automatically cropped.

## Screenshots

Open Settings → **播放偏好** (Playback preferences) → **视频截图** (Video screenshots), choose a destination, and click “保存截图设置” (Save screenshot settings). An empty path uses `screenshots/` under the active data directory. A custom directory must already exist and be writable.

Click the camera icon or press **C** to save a PNG without a dialog or interruption. Filenames include title, playback time and capture time and do not overwrite each other. Native actions reveal images and open their destination.

Screenshots capture the **currently decoded image** at its decoded dimensions, excluding controls, text-subtitle overlays, and display-layer zoom or rotation. Subtitles burned into the source remain visible. During transcoded playback, the screenshot captures the transcoded output, not guaranteed original HDR / 10-bit data. Paused frame-by-frame selection is not currently available. **C is the only screenshot shortcut.**

## Data, backup, and migration

The default is `AVHub-data/` beside the app. Do not run multiple instances against the same library:

| Runtime | Default location |
| --- | --- |
| Source Electron mode | `AVHub-data/` in the project root |
| Electron portable EXE | `AVHub-data/` next to the EXE, falling back to Electron's user configuration directory if unwritable |
| Custom location | Electron Settings → Data management → Custom data directory; `AVHUB_DATA_DIR` still takes highest priority |

The data directory contains `library.db`, thumbnails, custom artwork, and playback caches. Desktop mode also stores Chromium profile data and logs. Screenshots default to this directory but can use a separate location.

Choose an **empty directory** in desktop Settings. The current session keeps its original location; after a normal exit, the next launch copies a consistent SQLite snapshot, preferences, progress, playlists and artwork. The old directory remains intact. Source videos, screenshots, playback caches and Chromium profiles are not copied. Migration refuses to overwrite a library and stops startup on failure; back up first and leave sufficient free space (current migration limit: 2 GB).

The location is stored beside the app in `avhub-data-location.json`, excluded from Git. An old default library is copied to an empty `AVHub-data/` on upgrade; separate libraries are not merged. Custom absolute paths do not automatically relocate with a portable app.

For example, run the desktop development app with a dedicated data directory:

```powershell
$env:AVHUB_DATA_DIR = 'D:\AVHubData'
npm run dev
```

- **Database backup** contains SQLite data only, not artwork, videos, or screenshots.
- **Full-library backup** includes the database and custom artwork, with optional thumbnails. It excludes source videos, screenshots, and temporary HLS caches.
- Back up the current library before restoring. Do not run multiple backend instances against one data directory.
- To move a portable build, fully exit the app and move the EXE together with `AVHub-data/`. External video paths must remain accessible or be relocated in Settings.
- A custom screenshot destination does not move automatically with the portable directory. Back up screenshots separately.
- Settings' cache cleanup handles only app-managed cleanable data, not source videos or user screenshots.

## Development and tests

### Desktop development

```powershell
npm run dev
```

Exit normally and rerun this command after edits. Vite builds the internal UI only. Browser tests use an explicitly marked isolated harness; acceptance uses real Electron or the portable EXE.

### Common verification commands

Use the Python environment containing the installed dependencies. UI tests use locally installed Microsoft Edge; media tests require FFmpeg.

```powershell
npm run build
npm run build:electron
npm run test:backend
npm run test:ui
npm run test:electron
npm run test:electron:screenshots
npm run test:electron:window
npm run test:electron:library-controls
npm run test:electron:shutdown
```

Additional desktop checks, seeking benchmarks, and large-library benchmarks are listed in [package.json](package.json) and [scripts/](scripts/). Distinguish synthetic index queries, real disk scans, and real playback measurements; no single benchmark represents every video. Long HEVC playback and real HDR / 10-bit display and conversion have not yet received sufficient real-media validation.

## Build a Windows portable app

Packaging is unnecessary for everyday development. For distribution, prepare a Windows x64 environment with Python, Node.js, `bin/ffmpeg.exe`, `bin/ffprobe.exe`, and matching license documentation.

Run in **PowerShell 7**:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

The script installs runtime and build dependencies, builds the web UI and Electron code, packages the Python backend with PyInstaller, and produces a portable EXE. Dependency downloads require internet access. The resulting app bundles its runtime components; users do not need to install Python, Node.js, or FFmpeg separately for everyday use.

Output:

```text
dist/electron/AVHub-portable-<version>-x64.exe
```

The current `package.json` version is `0.2.0`. Existing EXEs do not load updated workspace source; rebuild the package to update the distributed app.

If `pwsh` is not recognized, install PowerShell 7 and reopen the terminal. Windows' built-in `powershell.exe` is commonly version 5.1 and is not equivalent to `pwsh`. The current script contains UTF-8 Chinese text, which can cause parsing errors under 5.1. Investigate build errors rather than mistaking an existing old EXE for a successful new build.

## Project layout

```text
avhub/
├─ frontend/src/          React + TypeScript UI and player
├─ electron/src/          Desktop window, backend lifecycle, native bridge
├─ electron/assets/       App icons
├─ app/                   FastAPI, SQLite, scanning, playback, data services
│  └─ static/             Generated web assets (not tracked by Git)
├─ bin/                   FFmpeg executables and license documentation
├─ scripts/               Packaging, build identity, performance tools
│  └─ build-windows.ps1   Windows portable build entry point
├─ tests/                 Backend and Playwright regression tests
├─ docs/                  Iteration, audit, and targeted validation records
├─ run.py                 Internal Electron backend / migration entry
├─ requirements.txt       Python runtime dependencies
├─ requirements-build.txt Python packaging dependencies
└─ package.json           Frontend, desktop, and verification commands
```

React / TypeScript implements the UI, with hls.js for HLS playback. FastAPI binds only to `127.0.0.1`; SQLite stores metadata, FFprobe analyzes media, and FFmpeg generates images, remuxes, and transcodes. Electron manages desktop window capabilities and application lifecycle.

## Troubleshooting and limitations

- **Blank page, build mismatch, or updates not appearing**: fully exit old instances, run `npm run build`, and restart. For source desktop mode, use `npm run electron:dev`. Generated web assets are not tracked by Git.
- **Scan, artwork, or transcoding fails**: check FFmpeg / FFprobe paths, folder permissions, disk availability, and thumbnail queue status. Inspect Runtime diagnostics.
- **The library appears empty**: check the current/pending data location and AVHUB_DATA_DIR. Source desktop and portable builds use directories beside their respective app locations.
- **A file still seeks slowly or does not play**: inspect the actual playback path, codecs, and errors in diagnostics. Remuxing, transcoding, keyframe structure, and hardware capabilities can all affect playback.
- **Videos are missing after restore or migration**: backups do not include source videos. Restore their accessibility or relocate the directory in Settings, then refresh.
- **Offline operation, platform, and privacy**: everyday functions do not depend on external services, but initial dependency installation and build downloads are not offline. Data and diagnostics can include local paths and video titles; redact reports before sharing them publicly.

MPV integration, online artwork scraping, account sync, casting, and mobile remote control are not provided. macOS / Linux are not current formally supported desktop portable targets. Complete compatibility with HDR, Dolby Vision, complex subtitles, and every browser combination is not guaranteed.

See [docs/](docs/) for historical records. Withdrawn designs in those records are not current features; this README describes the current source.

## License

The project uses [GNU GPL v3](LICENSE). Third-party components, including FFmpeg, retain their own licenses. See [bin/FFmpeg-BUILD-INFO.txt](bin/FFmpeg-BUILD-INFO.txt) and [bin/FFmpeg-LICENSE.txt](bin/FFmpeg-LICENSE.txt). When distributing a portable build, verify the actual third-party build, its license, and corresponding source information.
