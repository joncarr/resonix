import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  FileAudio,
  Folder,
  HardDrive,
  Pause,
  Play,
  Repeat,
  Square,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";

type AudioFileMetadata = {
  filename: string;
  path: string;
  extension: string;
  fileSize: number;
  durationSeconds: number | null;
  sampleRate: number | null;
  channelCount: number | null;
};

type FileBrowserEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  audioFile: AudioFileMetadata | null;
};

type PlaybackStatus = "stopped" | "playing" | "paused";

type WaveformCanvasProps = {
  peaks: number[];
};

type ContextMenuState = {
  x: number;
  y: number;
  file: AudioFileMetadata;
} | null;

const ROOT_KEY = "__roots__";

function WaveformCanvas({ peaks }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);

    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#0e1217";
    context.fillRect(0, 0, rect.width, rect.height);

    if (peaks.length === 0) {
      context.fillStyle = "#4b5563";
      context.fillText("No waveform loaded", 16, rect.height / 2);
      return;
    }

    const centerY = rect.height / 2;
    const barWidth = Math.max(1, rect.width / peaks.length);

    context.fillStyle = "#7f8da0";
    peaks.forEach((peak, index) => {
      const height = Math.max(1, peak * rect.height * 0.86);
      const x = index * barWidth;
      const y = centerY - height / 2;
      context.fillRect(x, y, Math.max(1, barWidth - 1), height);
    });
  }, [peaks]);

  return <canvas className="waveform-canvas" ref={canvasRef} />;
}

function App() {
  const [treeEntries, setTreeEntries] = useState<Record<string, FileBrowserEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [files, setFiles] = useState<AudioFileMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>("stopped");
  const [isLooping, setIsLooping] = useState(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [waveformError, setWaveformError] = useState("");
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const filteredFiles = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return files;
    }

    return files.filter((file) => {
      return [file.filename, file.path, file.extension]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [files, searchQuery]);

  const selectedFile =
    filteredFiles.find((file) => file.path === selectedPath) ??
    files.find((file) => file.path === selectedPath) ??
    null;

  useEffect(() => {
    loadDirectory(null, ROOT_KEY);
  }, []);

  useEffect(() => {
    function closeContextMenu() {
      setContextMenu(null);
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenu);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenu);
    };
  }, []);

  useEffect(() => {
    if (filteredFiles.length === 0) {
      return;
    }

    if (!filteredFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(filteredFiles[0].path);
    }
  }, [filteredFiles, selectedPath]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWaveform(filePath: string) {
      setIsLoadingWaveform(true);
      setWaveformError("");

      try {
        const peaks = await invoke<number[]>("generate_waveform", {
          filePath,
          peakCount: 640,
        });

        if (!isCancelled) {
          setWaveformPeaks(peaks);
        }
      } catch (waveformLoadError: unknown) {
        if (!isCancelled) {
          setWaveformPeaks([]);
          setWaveformError(String(waveformLoadError));
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingWaveform(false);
        }
      }
    }

    if (selectedFile) {
      loadWaveform(selectedFile.path);
    } else {
      setWaveformPeaks([]);
      setWaveformError("");
      setIsLoadingWaveform(false);
    }

    return () => {
      isCancelled = true;
    };
  }, [selectedFile]);

  async function loadDirectory(path: string | null, cacheKey = path ?? ROOT_KEY) {
    setLoadingPaths((paths) => new Set(paths).add(cacheKey));
    setBrowserError("");

    try {
      const entries = await invoke<FileBrowserEntry[]>("list_directory", { path });
      setTreeEntries((previous) => ({ ...previous, [cacheKey]: entries }));

      if (path) {
        const audioFiles = entries
          .filter((entry) => !entry.isDirectory && entry.audioFile)
          .map((entry) => entry.audioFile as AudioFileMetadata);
        setFiles(audioFiles);
        setCurrentDirectory(path);
        setSelectedPath(audioFiles[0]?.path ?? null);
        setSearchQuery("");
        setPlaybackStatus("stopped");
      }
    } catch (directoryError: unknown) {
      setBrowserError(String(directoryError));
    } finally {
      setLoadingPaths((paths) => {
        const nextPaths = new Set(paths);
        nextPaths.delete(cacheKey);
        return nextPaths;
      });
    }
  }

  async function toggleDirectory(path: string) {
    const isExpanded = expandedPaths.has(path);

    if (isExpanded) {
      setExpandedPaths((paths) => {
        const nextPaths = new Set(paths);
        nextPaths.delete(path);
        return nextPaths;
      });
      return;
    }

    setExpandedPaths((paths) => new Set(paths).add(path));

    if (!treeEntries[path]) {
      await loadDirectory(path);
    } else {
      await loadDirectory(path);
    }
  }

  async function selectAudioFile(file: AudioFileMetadata) {
    setFiles((currentFiles) => {
      if (currentFiles.some((currentFile) => currentFile.path === file.path)) {
        return currentFiles;
      }

      return [file, ...currentFiles];
    });
    setSelectedPath(file.path);
    await playFile(file);
  }

  function openContextMenu(
    event: MouseEvent<HTMLElement>,
    file: AudioFileMetadata,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPath(file.path);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      file,
    });
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function formatDuration(seconds: number | null) {
    if (seconds == null) {
      return "-";
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60)
      .toString()
      .padStart(2, "0");

    return `${minutes}:${remainingSeconds}`;
  }

  function selectRelativeFile(offset: number) {
    if (filteredFiles.length === 0) {
      return;
    }

    const selectedIndex = filteredFiles.findIndex(
      (file) => file.path === selectedPath,
    );
    const nextIndex =
      selectedIndex === -1
        ? 0
        : Math.min(Math.max(selectedIndex + offset, 0), filteredFiles.length - 1);

    setSelectedPath(filteredFiles[nextIndex].path);
  }

  async function playSelectedFile() {
    if (!selectedFile) {
      return;
    }

    await playFile(selectedFile);
  }

  async function playFile(file: AudioFileMetadata) {
    try {
      await invoke("play_file_with_loop", {
        filePath: file.path,
        loopEnabled: isLooping,
      });
      setPlaybackStatus("playing");
      setError("");
    } catch (playbackError: unknown) {
      setPlaybackStatus("stopped");
      setError(`Could not play file: ${String(playbackError)}`);
    }
  }

  async function revealFile(file: AudioFileMetadata) {
    try {
      await revealItemInDir(file.path);
      setError("");
    } catch (revealError: unknown) {
      setError(`Could not reveal file: ${String(revealError)}`);
    }
  }

  async function copyFilePath(file: AudioFileMetadata) {
    try {
      await writeText(file.path);
      setError("");
    } catch (copyError: unknown) {
      setError(`Could not copy path: ${String(copyError)}`);
    }
  }

  async function runContextMenuAction(action: "play" | "reveal" | "copy") {
    if (!contextMenu) {
      return;
    }

    const file = contextMenu.file;
    setContextMenu(null);

    if (action === "play") {
      setSelectedPath(file.path);
      await playFile(file);
      return;
    }

    if (action === "reveal") {
      await revealFile(file);
      return;
    }

    await copyFilePath(file);
  }

  async function togglePause() {
    try {
      if (playbackStatus === "playing") {
        await invoke("pause_playback");
        setPlaybackStatus("paused");
        return;
      }

      if (playbackStatus === "paused") {
        await invoke("resume_playback");
        setPlaybackStatus("playing");
      }
    } catch (playbackError: unknown) {
      setError(`Could not update playback: ${String(playbackError)}`);
    }
  }

  async function stopPlayback() {
    try {
      await invoke("stop_playback");
      setPlaybackStatus("stopped");
    } catch (playbackError: unknown) {
      setError(`Could not stop playback: ${String(playbackError)}`);
    }
  }

  async function toggleLoop() {
    const nextLoopState = !isLooping;
    setIsLooping(nextLoopState);

    if (selectedFile && playbackStatus !== "stopped") {
      try {
        await invoke("play_file_with_loop", {
          filePath: selectedFile.path,
          loopEnabled: nextLoopState,
        });
        setPlaybackStatus("playing");
        setError("");
      } catch (playbackError: unknown) {
        setPlaybackStatus("stopped");
        setError(`Could not update loop playback: ${String(playbackError)}`);
      }
    }
  }

  function handleBrowserKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectRelativeFile(1);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectRelativeFile(-1);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      playSelectedFile();
    }
  }

  function handleAppKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const isTyping =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (isTyping) {
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      if (playbackStatus === "stopped") {
        playSelectedFile();
      } else {
        togglePause();
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      stopPlayback();
    }
  }

  function renderTree(entries: FileBrowserEntry[] = [], depth = 0) {
    return entries.map((entry) => {
      const isExpanded = expandedPaths.has(entry.path);
      const isLoading = loadingPaths.has(entry.path);
      const childEntries = treeEntries[entry.path] ?? [];

      if (entry.isDirectory) {
        return (
          <div className="tree-node" key={entry.path}>
            <button
              className={`tree-row ${currentDirectory === entry.path ? "active-tree-row" : ""}`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              type="button"
              onClick={() => toggleDirectory(entry.path)}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {depth === 0 ? <HardDrive size={16} /> : <Folder size={16} />}
              <span>{entry.name}</span>
              {isLoading ? <span className="tree-loading">...</span> : null}
            </button>
            {isExpanded ? renderTree(childEntries, depth + 1) : null}
          </div>
        );
      }

      if (!entry.audioFile) {
        return null;
      }

      return (
        <button
          className={`tree-row audio-tree-row ${
            selectedPath === entry.path ? "active-tree-row" : ""
          }`}
          key={entry.path}
          style={{ paddingLeft: `${30 + depth * 14}px` }}
          type="button"
          onClick={() => selectAudioFile(entry.audioFile as AudioFileMetadata)}
          onContextMenu={(event) =>
            openContextMenu(event, entry.audioFile as AudioFileMetadata)
          }
        >
          <FileAudio size={15} />
          <span>{entry.name}</span>
        </button>
      );
    });
  }

  return (
    <main className="app-shell" onKeyDown={handleAppKeyDown}>
      <section className="player-region">
        <header className="title-bar">
          <div>
            <span className="app-mark">Resonix</span>
            <span className="title-file">
              {selectedFile ? selectedFile.filename : "No file selected"}
            </span>
          </div>
          <span className="title-status">{playbackStatus}</span>
        </header>

        <section className="preview-panel" aria-label="Waveform preview">
          <div className="preview-header">
            <div>
              <p className="selection-label">Waveform</p>
              <p className="preview-title">
                {selectedFile ? selectedFile.filename : "No file selected"}
              </p>
            </div>
            <p className="preview-status">
              {isLoadingWaveform
                ? "Loading peaks"
                : waveformError
                  ? "Waveform unavailable"
                  : `${waveformPeaks.length.toLocaleString()} peaks`}
            </p>
          </div>
          <WaveformCanvas peaks={waveformPeaks} />
          {waveformError ? (
            <p className="status error waveform-error">{waveformError}</p>
          ) : null}
        </section>

        <section className="transport-bar" aria-label="Transport controls">
          <div className="transport-file">
            <span className="transport-label">Transport</span>
            <span>{selectedFile?.filename ?? "No file selected"}</span>
          </div>
          <div className="transport-controls">
            <button
              className="transport-icon-button"
              type="button"
              onClick={playSelectedFile}
              disabled={!selectedFile}
              aria-label="Play selected file"
              title="Play"
            >
              <Play aria-hidden="true" fill="currentColor" size={22} />
            </button>
            <button
              className="transport-icon-button"
              type="button"
              onClick={togglePause}
              disabled={playbackStatus === "stopped"}
              aria-label={
                playbackStatus === "paused" ? "Resume playback" : "Pause playback"
              }
              title={playbackStatus === "paused" ? "Resume" : "Pause"}
            >
              <Pause aria-hidden="true" fill="currentColor" size={22} />
            </button>
            <button
              className="transport-icon-button"
              type="button"
              onClick={stopPlayback}
              disabled={playbackStatus === "stopped"}
              aria-label="Stop playback"
              title="Stop"
            >
              <Square aria-hidden="true" fill="currentColor" size={20} />
            </button>
            <button
              className={`transport-icon-button ${isLooping ? "active-transport-icon" : ""}`}
              type="button"
              onClick={toggleLoop}
              aria-pressed={isLooping}
              aria-label={isLooping ? "Turn loop off" : "Turn loop on"}
              title={isLooping ? "Loop on" : "Loop off"}
            >
              <Repeat aria-hidden="true" size={20} />
            </button>
          </div>
        </section>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <p className="eyebrow">Browser</p>
          </div>
          <div className="file-tree" aria-label="File browser tree">
            {renderTree(treeEntries[ROOT_KEY])}
            {loadingPaths.has(ROOT_KEY) ? (
              <p className="tree-status">Loading drives...</p>
            ) : null}
            {browserError ? <p className="tree-status error">{browserError}</p> : null}
          </div>
        </aside>

        <section className="content">
        <section className="browser-toolbar" aria-label="File browser controls">
          <div className="search-field">
            <label htmlFor="file-search">Search current folder</label>
            <input
              id="file-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Name, path, or extension"
              disabled={files.length === 0}
            />
          </div>
          <div className="browser-summary">
            <span>{files.length.toLocaleString()} in folder</span>
            <span>{filteredFiles.length.toLocaleString()} shown</span>
          </div>
        </section>

        {selectedFile ? (
          <section className="selection-panel" aria-label="Selected file">
            <div>
              <p className="selection-label">Selected</p>
              <p className="selection-name">{selectedFile.filename}</p>
            </div>
            <p className="selection-path">{selectedFile.path}</p>
          </section>
        ) : null}

        {error ? <p className="status error">{error}</p> : null}
        {!error && !currentDirectory ? (
          <p className="status">Choose a folder in the sidebar to browse audio files.</p>
        ) : null}
        {!error && currentDirectory && files.length === 0 ? (
          <p className="status">No supported audio files in this folder.</p>
        ) : null}
        {!error && files.length > 0 && filteredFiles.length === 0 ? (
          <p className="status">
            No files match "{searchQuery.trim()}". Clear the search to show all files in
            this folder.
          </p>
        ) : null}

        <div
          className="table-wrap"
          onKeyDown={handleBrowserKeyDown}
          role="region"
          aria-label="Audio files in selected folder"
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Duration</th>
                <th>Sample Rate</th>
                <th>Channels</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => (
                <tr
                  className={file.path === selectedPath ? "selected-row" : ""}
                  key={file.path}
                  tabIndex={0}
                  aria-selected={file.path === selectedPath}
                  onContextMenu={(event) => openContextMenu(event, file)}
                  onClick={() => {
                    setSelectedPath(file.path);
                    playFile(file);
                  }}
                  onFocus={() => setSelectedPath(file.path)}
                >
                  <td>{file.filename}</td>
                  <td>{file.extension.toUpperCase()}</td>
                  <td>{formatBytes(file.fileSize)}</td>
                  <td>{formatDuration(file.durationSeconds)}</td>
                  <td>
                    {file.sampleRate == null
                      ? "-"
                      : `${file.sampleRate.toLocaleString()} Hz`}
                  </td>
                  <td>{file.channelCount ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </section>
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextMenuAction("play")}
          >
            Play
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextMenuAction("reveal")}
          >
            Reveal in Explorer
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextMenuAction("copy")}
          >
            Copy Path
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default App;
