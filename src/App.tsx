import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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

type PlaybackStatus = "stopped" | "playing" | "paused";

type WaveformCanvasProps = {
  peaks: number[];
};

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
    context.fillStyle = "#111318";
    context.fillRect(0, 0, rect.width, rect.height);

    if (peaks.length === 0) {
      context.fillStyle = "#4b5563";
      context.fillText("No waveform loaded", 16, rect.height / 2);
      return;
    }

    const centerY = rect.height / 2;
    const barWidth = Math.max(1, rect.width / peaks.length);

    context.fillStyle = "#38bdf8";
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
  const [folderPath, setFolderPath] = useState("");
  const [files, setFiles] = useState<AudioFileMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>("stopped");
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [waveformError, setWaveformError] = useState("");
  const [error, setError] = useState("");

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
    filteredFiles.find((file) => file.path === selectedPath) ?? null;

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedPath(null);
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

  async function chooseFolder() {
    try {
      const selectedFolder = await open({
        directory: true,
        multiple: false,
        title: "Select sample folder",
      });

      if (typeof selectedFolder === "string") {
        setFolderPath(selectedFolder);
        setError("");
      }
    } catch (dialogError: unknown) {
      setError(`Could not open folder picker: ${String(dialogError)}`);
    }
  }

  async function scanFolder() {
    const trimmedPath = folderPath.trim();

    if (!trimmedPath) {
      setError("Enter a folder path to scan.");
      setFiles([]);
      setSelectedPath(null);
      return;
    }

    setIsScanning(true);
    setError("");

    try {
      const scannedFiles = await invoke<AudioFileMetadata[]>("scan_folder", {
        folderPath: trimmedPath,
      });
      setFiles(scannedFiles);
      setSelectedPath(scannedFiles[0]?.path ?? null);
      setPlaybackStatus("stopped");
    } catch (scanError: unknown) {
      setFiles([]);
      setSelectedPath(null);
      setError(String(scanError));
    } finally {
      setIsScanning(false);
    }
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

    try {
      await invoke("play_file", { filePath: selectedFile.path });
      setPlaybackStatus("playing");
      setError("");
    } catch (playbackError: unknown) {
      setPlaybackStatus("stopped");
      setError(`Could not play file: ${String(playbackError)}`);
    }
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

  return (
    <main className="app-shell" onKeyDown={handleAppKeyDown}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Resonix</p>
          <h1>Sample Library</h1>
        </div>
        <p className="sidebar-copy">
          Scan a local folder for WAV, MP3, FLAC, and OGG files.
        </p>
      </aside>

      <section className="content">
        <form
          className="scan-bar"
          onSubmit={(event) => {
            event.preventDefault();
            scanFolder();
          }}
        >
          <label htmlFor="folder-path">Folder path</label>
          <div className="scan-controls">
            <input
              id="folder-path"
              value={folderPath}
              onChange={(event) => setFolderPath(event.currentTarget.value)}
              placeholder="C:\\Users\\jonec\\Music\\Samples"
            />
            <button
              className="secondary-button"
              type="button"
              onClick={chooseFolder}
              disabled={isScanning}
            >
              Browse
            </button>
            <button type="submit" disabled={isScanning}>
              {isScanning ? "Scanning..." : "Scan"}
            </button>
          </div>
        </form>

        <section className="browser-toolbar" aria-label="File browser controls">
          <div className="search-field">
            <label htmlFor="file-search">Search files</label>
            <input
              id="file-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Name, path, or extension"
              disabled={files.length === 0}
            />
          </div>
          <div className="browser-summary">
            <span>{files.length.toLocaleString()} scanned</span>
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

        {error ? <p className="status error">{error}</p> : null}
        {!error && isScanning ? <p className="status">Scanning folder...</p> : null}
        {!error && !isScanning && files.length === 0 ? (
          <p className="status">Choose a folder, then scan to populate the browser.</p>
        ) : null}
        {!error &&
        !isScanning &&
        files.length > 0 &&
        filteredFiles.length === 0 ? (
          <p className="status">
            No files match "{searchQuery.trim()}". Clear the search to show all scanned
            files.
          </p>
        ) : null}

        <div
          className="table-wrap"
          onKeyDown={handleBrowserKeyDown}
          role="region"
          aria-label="Scanned audio files"
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
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => (
                <tr
                  className={file.path === selectedPath ? "selected-row" : ""}
                  key={file.path}
                  tabIndex={0}
                  aria-selected={file.path === selectedPath}
                  onClick={() => setSelectedPath(file.path)}
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
                  <td className="path-cell">{file.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="transport-bar" aria-label="Transport controls">
        <div className="transport-file">
          <span className="transport-label">Transport</span>
          <span>{selectedFile?.filename ?? "No file selected"}</span>
        </div>
        <div className="transport-controls">
          <button type="button" onClick={playSelectedFile} disabled={!selectedFile}>
            Play
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={togglePause}
            disabled={playbackStatus === "stopped"}
          >
            {playbackStatus === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={stopPlayback}
            disabled={playbackStatus === "stopped"}
          >
            Stop
          </button>
        </div>
      </footer>
    </main>
  );
}

export default App;
