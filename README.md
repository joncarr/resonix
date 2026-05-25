# Resonix

Resonix is a Rust/Tauri desktop app for browsing and previewing local audio samples quickly. It provides a compact file-browser workflow with metadata scanning, playback, waveform previews, favorites, and a real-time spectrum view.

The app is early MVP software. Windows is the most exercised target today, but the codebase is intended to stay portable across Windows, Linux, and macOS where Tauri and the audio backend support it.

## Screenshots

![Resonix dark theme waveform browser](https://raw.githubusercontent.com/joncarr/resonix/refs/heads/master/src/assets/rsnx_dark.jpg)

![Resonix light theme waveform browser](https://raw.githubusercontent.com/joncarr/resonix/refs/heads/master/src/assets/rsnx_light.jpg)

## Features

- Browse local drives and folders from a sidebar.
- Detect supported audio files in selected folders.
- Display filename, extension, size, duration, BPM, sample rate, and channels.
- Render waveform thumbnails in the file table.
- Show a larger cached waveform preview for the selected file.
- Play, pause, stop, seek, loop, mute, dim, and adjust volume.
- Toggle the preview area into a live spectrum analyzer during playback.
- Mark files as favorites.
- Restore app state, including theme, last directory, and selected file.
- Cache audio metadata and waveform peaks in SQLite.
- Drag files out of the app on Windows.

## Supported Formats

- WAV
- MP3
- FLAC
- OGG

## Tech Stack

- Tauri v2
- Rust backend
- React and TypeScript frontend
- Vite
- SQLite via `rusqlite`
- Symphonia for metadata and waveform decoding
- Rodio/CPAL for playback
- Walkdir for recursive scanning

## Requirements

Install Rust, Node.js, and npm before working on the app.

```bash
rustup --version
node --version
npm --version
```

Install JavaScript dependencies:

```bash
npm install
```

### Linux Dependencies

On Ubuntu/Debian, install the GTK/WebKit, audio, and packaging libraries used by Tauri and Rodio:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev \
  xdg-utils \
  patchelf
```

Package names vary by distribution. The important Linux system dependencies are WebKitGTK 4.1, GTK 3, librsvg, OpenSSL headers, xdo, ALSA development headers, xdg-utils, and standard build tooling.

## Development

Run the desktop app in development mode:

```bash
npm run tauri dev
```

Run a frontend production build:

```bash
npm run build
```

Check the Rust backend:

```bash
cd src-tauri
cargo check
```

Format Rust code:

```bash
cd src-tauri
cargo fmt
```

Build an Ubuntu/Debian release package:

```bash
npm run tauri -- build --bundles deb
```

The `.deb` release artifact is written under:

```text
src-tauri/target/release/bundle/deb/
```

To build every configured Linux bundle target on a fully provisioned machine, run:

```bash
npm run tauri build
```

## Project Layout

```text
src/
  App.tsx
  App.css
  main.tsx
  assets/

src-tauri/src/
  audio/
    bpm.rs
    playback.rs
    waveform.rs
  library/
    browser.rs
    database.rs
    metadata.rs
    scanner.rs
  platform/
    file_drag.rs
  commands.rs
  lib.rs
  main.rs
```

## Backend Commands

The frontend talks to Rust through Tauri commands. The main commands are:

- `list_directory` for drive/folder browsing.
- `scan_folder` for recursive audio scanning.
- `generate_waveform` for waveform peak generation.
- `play_file_with_loop`, `pause_playback`, `resume_playback`, and `stop_playback` for transport control.
- `get_spectrum` for the live spectrum analyzer.
- `list_favorites`, `add_favorite`, `remove_favorite`, and `is_favorite` for favorites.
- `restore_app_state`, `remember_selected_file`, and `remember_theme` for state restore.
- `start_file_drag` for native drag-out on Windows.

## Platform Notes

Native file drag-out is currently implemented only for Windows. On Linux and macOS, attempting to drag a file out of the app returns an unsupported-platform error until a platform implementation is added.

Linux builds need ALSA development headers because playback uses Rodio/CPAL. If `cargo check` or `npm run tauri dev` fails with `alsa.pc` missing, install `libasound2-dev` or the equivalent package for your distribution.

AppImage bundling needs `/usr/bin/xdg-open`, which is provided by `xdg-utils` on Ubuntu/Debian. If `npm run tauri build` fails while bundling an AppImage with `xdg-open binary not found`, install `xdg-utils` or build only the Debian package with `npm run tauri -- build --bundles deb`.

If a Linux build launches but the app window is blank, run it from a terminal so WebKitGTK or graphics-process errors are visible. On some Wayland or GPU driver combinations, WebKitGTK may need:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

For a packaged binary, set the same environment variable before running the app executable.

## Current Status

Resonix is a small, direct MVP. Browsing, metadata caching, waveform previews, playback, BPM estimation, favorites, theme restore, Windows drag-out, and the spectrum analyzer are in place. BPM detection is best-effort and may return no value for short, ambient, noisy, or low-confidence files.
