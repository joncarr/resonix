# AGENTS.md

## Project Overview

Resonix is a Rust/Tauri desktop application for fast audio sample browsing and previewing. It is inspired by the workflow of fast audio browsers, but it must be an original application and not a clone of any existing product.

The MVP is a local desktop app that lets a user choose a folder, recursively scan supported audio files, display them in a searchable table, play selected files quickly, and show a simple waveform preview.

## Tech Stack

- Tauri v2
- Rust backend
- React frontend
- JavaScript
- Tailwind CSS
- SQLite for local cache
- Symphonia for decoding/audio analysis
- Rodio or CPAL for playback
- Walkdir for recursive scanning
- Rayon for background/parallel processing where appropriate
- Serde for data serialization

## MVP Features

Build the app in small, working milestones.

### Milestone 1: Project Structure

Create a clean structure for the Rust backend and React frontend.

Suggested Rust modules:

- `audio/playback.rs`
- `audio/decode.rs`
- `audio/waveform.rs`
- `library/scanner.rs`
- `library/metadata.rs`
- `library/database.rs`
- `commands.rs`

Suggested frontend components:

- `Sidebar.tsx`
- `FileBrowser.tsx`
- `Waveform.tsx`
- `Transport.tsx`
- `Inspector.tsx`

### Milestone 2: Folder Scanning

Implement folder selection and recursive scanning for audio files.

Initial supported formats:

- WAV
- MP3
- FLAC
- OGG

For each file, collect:

- filename
- full path
- extension
- file size
- duration if available
- sample rate if available
- channel count if available

Expose this through a Tauri command callable from the frontend.

### Milestone 3: Searchable File Browser

Create a React UI that displays scanned files in a searchable table.

The UI should include:

- folder picker button
- search input
- file table
- selected file state
- clean empty/loading/error states

### Milestone 4: Playback

Implement basic audio playback:

- play selected file
- pause
- stop
- seek if practical in the first pass

Keep playback code isolated in the Rust backend.

### Milestone 5: Waveform Preview

Generate simplified waveform peak data for selected files.

Return an array of normalized peak values to the frontend.

Render the waveform using canvas or SVG.

### Milestone 6: SQLite Cache

Cache scanned metadata and waveform peak data locally so repeat scans are fast.

Do not over-engineer the schema at first. Keep it simple and migrate later if needed.

## UX Direction

The app should feel fast, clean, and professional.

Use a dark audio-production style UI with:

- left sidebar
- main file browser
- bottom transport bar
- waveform preview area
- keyboard shortcuts

Useful keyboard shortcuts:

- Space: play/pause
- Escape: stop
- Up/down: move selection
- Enter: play selected file

## Important Instructions

- Read this AGENTS.md before making changes.
- Keep changes small and testable.
- Do not attempt to build every feature at once.
- Do not clone branding, UI text, logos, or proprietary behavior from Resonic.
- Prefer simple working code over complex abstractions.
- Keep Rust backend code modular.
- Do not block the UI while scanning or generating waveforms.
- Use Tauri commands for frontend/backend communication.
- Add clear comments where Rust audio/file code may be non-obvious.
- Run formatting and checks before finishing meaningful changes.

## First Task

Start by inspecting the existing Tauri project structure. Then implement Milestone 1 and Milestone 2:

1. Create the backend module structure.
2. Add a Tauri command that scans a selected folder path recursively.
3. Return a list of audio files with basic metadata.
4. Add a simple frontend folder path input and scan button.
5. Display the returned files in a table.