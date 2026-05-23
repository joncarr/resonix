# Resonix

Resonix is a Rust/Tauri desktop app for fast local audio sample browsing and previewing. It is built around a dark audio-production workflow: browse folders, inspect supported audio files, play samples quickly, view waveform peaks, and switch to a real-time spectrum analyzer while playback is running.

## Features

- Browse local drives and folders from a sidebar.
- Detect supported audio files in the selected folder.
- Display filename, type, size, duration, sample rate, and channel count.
- Play, pause, stop, loop, seek, mute, dim, and adjust playback volume.
- Render cached waveform previews for selected samples.
- Toggle the preview area into a live spectrum analyzer from the transport bar.
- Mark files as favorites.
- Restore recent app state such as theme, last directory, and selected file.
- Cache metadata and waveform peaks in SQLite for faster repeat browsing.
- Drag files out of the app on Windows.

## Tech Stack

- Tauri v2
- Rust backend
- React frontend
- TypeScript
- Vite
- SQLite via `rusqlite`
- Symphonia for audio metadata and waveform decoding
- Rodio for playback
- Walkdir for recursive folder scanning

## Supported Audio Formats

Initial supported formats:

- WAV
- MP3
- FLAC
- OGG

## Development

Install JavaScript dependencies:

```bash
npm install
```

Run the desktop app in development mode:

```bash
npm run tauri dev
```

Run a frontend production build:

```bash
npm run build
```

Run Rust checks:

```bash
cd src-tauri
cargo check
```

Format Rust code:

```bash
cd src-tauri
cargo fmt
```

Build the packaged desktop app:

```bash
npm run tauri build
```

Build artifacts are written under:

```text
src-tauri/target/release/bundle/
```

## Project Structure

```text
src/
  App.tsx
  App.css
  main.tsx

src-tauri/src/
  audio/
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

## Platform Notes

Windows is the primary development target right now.

The app should be portable to Linux through Tauri, but native file drag-out is currently implemented only for Windows. On non-Windows platforms, the drag command returns an unsupported-platform error until a platform-specific implementation is added.

## Linux Build Dependencies

On Ubuntu/Debian, a Linux build usually requires Tauri's GTK/WebKit dependencies:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  build-essential \
  curl \
  wget \
  file
```

Then run:

```bash
npm install
npm run tauri build
```

## Current Status

Resonix is an early MVP. The core browsing, playback, waveform, favorites, cache, and real-time spectrum analyzer paths are in place. The codebase is intentionally still small and direct so new audio features can be added without over-engineering the architecture too early.
