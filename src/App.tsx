import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  HardDrive,
  Pause,
  Play,
  Repeat,
  Square,
  Activity,
  Moon,
  Star,
  Sun,
  Volume1,
  Volume2,
  VolumeX,
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
type Theme = "dark" | "light";
type VisualizerMode = "waveform" | "spectrum";

type WaveformCanvasProps = {
  peaks: number[];
  playheadProgress: number;
  playheadSeconds: number;
  onSeek: (progress: number) => void;
};

type SpectrumCanvasProps = {
  bins: number[];
  isActive: boolean;
};

type WaveformThumbnailProps = {
  filePath: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  file: AudioFileMetadata;
  isFavorite: boolean;
} | null;

type AppRestoreState = {
  lastDirectory: string | null;
  lastFile: string | null;
  theme: string | null;
};

const ROOT_KEY = "__roots__";

function buildDirectoryRestoreChain(path: string) {
  const normalizedPath = path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\//g, "\\");

  if (/^[A-Za-z]:\\/.test(normalizedPath)) {
    const driveRoot = normalizedPath.slice(0, 3);
    const parts = normalizedPath.slice(3).split("\\").filter(Boolean);
    const chain = [driveRoot];
    let currentPath = driveRoot;

    for (const part of parts) {
      currentPath = currentPath.endsWith("\\")
        ? `${currentPath}${part}`
        : `${currentPath}\\${part}`;
      chain.push(currentPath);
    }

    return chain;
  }

  if (path.startsWith("/")) {
    const parts = path.split("/").filter(Boolean);
    const chain = ["/"];
    let currentPath = "";

    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      chain.push(currentPath);
    }

    return chain;
  }

  return [path];
}

function WaveformCanvas({
  peaks,
  playheadProgress,
  playheadSeconds,
  onSeek,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function drawWaveform(nextPlayheadProgress: number) {
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
    const styles = getComputedStyle(canvas);
    const waveformBackground =
      styles.getPropertyValue("--waveform-background").trim() || "#0e1217";
    const waveformForeground =
      styles.getPropertyValue("--waveform-foreground").trim() || "#7f8da0";
    const waveformEmpty =
      styles.getPropertyValue("--waveform-empty").trim() || "#4b5563";
    const markerLabelBackground =
      styles.getPropertyValue("--marker-label-background").trim() ||
      "rgba(13, 18, 24, 0.88)";
    const markerLabelBorder =
      styles.getPropertyValue("--marker-label-border").trim() ||
      "rgba(125, 211, 252, 0.72)";
    const markerLabelText =
      styles.getPropertyValue("--marker-label-text").trim() || "#dff4ff";

    context.fillStyle = waveformBackground;
    context.fillRect(0, 0, rect.width, rect.height);

    if (peaks.length === 0) {
      context.fillStyle = waveformEmpty;
      context.fillText("No waveform loaded", 16, rect.height / 2);
      return;
    }

    const centerY = rect.height / 2;
    const barWidth = Math.max(1, rect.width / peaks.length);

    context.fillStyle = waveformForeground;
    peaks.forEach((peak, index) => {
      const height = Math.max(1, peak * rect.height * 0.86);
      const x = index * barWidth;
      const y = centerY - height / 2;
      context.fillRect(x, y, Math.max(1, barWidth - 1), height);
    });

    const markerX = Math.min(Math.max(nextPlayheadProgress, 0), 1) * rect.width;
    context.strokeStyle = "#7dd3fc";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(markerX, 0);
    context.lineTo(markerX, rect.height);
    context.stroke();

    const label = formatTimecode(playheadSeconds);
    context.font =
      '12px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const metrics = context.measureText(label);
    const labelWidth = metrics.width + 12;
    const labelHeight = 22;
    const labelX = Math.min(Math.max(markerX + 6, 6), rect.width - labelWidth - 6);
    const labelY = 8;

    context.fillStyle = markerLabelBackground;
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.strokeStyle = markerLabelBorder;
    context.strokeRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = markerLabelText;
    context.fillText(label, labelX + 6, labelY + 15);
  }

  useEffect(() => {
    drawWaveform(playheadProgress);
  }, [peaks, playheadProgress, playheadSeconds]);

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const progress = (event.clientX - rect.left) / rect.width;
    const nextProgress = Math.min(Math.max(progress, 0), 1);

    drawWaveform(nextProgress);
    onSeek(nextProgress);
  }

  return (
    <canvas
      className="waveform-canvas"
      onPointerDown={handlePointerDown}
      ref={canvasRef}
    />
  );
}

function SpectrumCanvas({ bins, isActive }: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function drawSpectrum() {
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

    const styles = getComputedStyle(canvas);
    const background =
      styles.getPropertyValue("--spectrum-background").trim() || "#0e1217";
    const barLow =
      styles.getPropertyValue("--spectrum-bar-low").trim() || "#38bdf8";
    const barHigh =
      styles.getPropertyValue("--spectrum-bar-high").trim() || "#f59e0b";
    const grid =
      styles.getPropertyValue("--spectrum-grid").trim() ||
      "rgba(127, 141, 160, 0.16)";
    const empty =
      styles.getPropertyValue("--spectrum-empty").trim() || "#4b5563";

    context.fillStyle = background;
    context.fillRect(0, 0, rect.width, rect.height);

    context.strokeStyle = grid;
    context.lineWidth = 1;
    for (let line = 1; line < 4; line += 1) {
      const y = (rect.height / 4) * line;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(rect.width, y);
      context.stroke();
    }

    if (!isActive || bins.length === 0) {
      context.fillStyle = empty;
      context.fillText(
        isActive ? "Waiting for playback" : "Spectrum paused",
        16,
        rect.height / 2,
      );
      return;
    }

    const gap = 2;
    const barWidth = Math.max(2, rect.width / bins.length - gap);
    const gradient = context.createLinearGradient(0, rect.height, 0, 0);
    gradient.addColorStop(0, barLow);
    gradient.addColorStop(1, barHigh);
    context.fillStyle = gradient;

    bins.forEach((bin, index) => {
      const magnitude = Math.min(Math.max(bin, 0), 1);
      const height = Math.max(2, magnitude * rect.height * 0.9);
      const x = index * (barWidth + gap);
      const y = rect.height - height;
      context.fillRect(x, y, barWidth, height);
    });
  }

  useEffect(() => {
    drawSpectrum();
  }, [bins, isActive]);

  return <canvas className="spectrum-canvas" ref={canvasRef} />;
}

function WaveformThumbnail({ filePath }: WaveformThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  function drawThumbnail(nextPeaks: number[]) {
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

    const styles = getComputedStyle(canvas);
    const background =
      styles.getPropertyValue("--thumbnail-background").trim() || "#0e1217";
    const foreground =
      styles.getPropertyValue("--thumbnail-foreground").trim() || "#7f8da0";
    const empty =
      styles.getPropertyValue("--thumbnail-empty").trim() || "#334155";

    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = background;
    context.fillRect(0, 0, rect.width, rect.height);

    if (nextPeaks.length === 0) {
      context.fillStyle = empty;
      context.fillRect(4, rect.height / 2, rect.width - 8, 1);
      return;
    }

    const centerY = rect.height / 2;
    const barWidth = Math.max(1, rect.width / nextPeaks.length);
    context.fillStyle = foreground;

    nextPeaks.forEach((peak, index) => {
      const height = Math.max(1, peak * rect.height * 0.76);
      const x = index * barWidth;
      const y = centerY - height / 2;
      context.fillRect(x, y, Math.max(1, barWidth - 1), height);
    });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadThumbnail() {
      try {
        const nextPeaks = await invoke<number[]>("generate_waveform", {
          filePath,
          peakCount: 48,
        });

        if (!isCancelled) {
          setPeaks(nextPeaks);
        }
      } catch {
        if (!isCancelled) {
          setPeaks([]);
        }
      }
    }

    setPeaks([]);
    loadThumbnail();

    return () => {
      isCancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    drawThumbnail(peaks);
  }, [peaks]);

  return (
    <canvas
      className="waveform-thumbnail"
      ref={canvasRef}
      aria-hidden="true"
    />
  );
}

function formatTimecode(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");
  const tenths = Math.floor((safeSeconds % 1) * 10);

  return `${minutes}:${wholeSeconds}.${tenths}`;
}

function App() {
  const [treeEntries, setTreeEntries] = useState<Record<string, FileBrowserEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);
  const [files, setFiles] = useState<AudioFileMetadata[]>([]);
  const [favoriteFiles, setFavoriteFiles] = useState<AudioFileMetadata[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] =
    useState<PlaybackStatus>("stopped");
  const [isLooping, setIsLooping] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isDimmed, setIsDimmed] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [playbackAnchor, setPlaybackAnchor] = useState<{
    offsetSeconds: number;
    startedAt: number;
  } | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [waveformError, setWaveformError] = useState("");
  const [visualizerMode, setVisualizerMode] =
    useState<VisualizerMode>("waveform");
  const [spectrumBins, setSpectrumBins] = useState<number[]>([]);
  const [spectrumError, setSpectrumError] = useState("");
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [hasLoadedRestoreState, setHasLoadedRestoreState] = useState(false);
  const pendingFileDrag = useRef<{
    file: AudioFileMetadata;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextFileClick = useRef(false);
  const [theme, setTheme] = useState<Theme>(() => {
    return localStorage.getItem("resonix-theme") === "light" ? "light" : "dark";
  });

  const selectedFile =
    files.find((file) => file.path === selectedPath) ??
    null;

  useEffect(() => {
    initializeLibraryState();
  }, []);

  async function initializeLibraryState() {
    try {
      await Promise.all([loadTreeEntries(null, ROOT_KEY), loadFavorites()]);
    } catch (libraryLoadError: unknown) {
      setBrowserError(String(libraryLoadError));
    }

    try {
      const restoreState = await invoke<AppRestoreState>("restore_app_state");

      if (restoreState.theme === "dark" || restoreState.theme === "light") {
        setTheme(restoreState.theme);
      }

      if (restoreState.lastDirectory) {
        const restoreChain = buildDirectoryRestoreChain(restoreState.lastDirectory);
        setExpandedPaths((paths) => {
          const nextPaths = new Set(paths);
          restoreChain.forEach((path) => nextPaths.add(path));
          return nextPaths;
        });

        for (const directory of restoreChain.slice(0, -1)) {
          await loadTreeEntries(directory);
        }

        const audioFiles = await loadDirectory(restoreState.lastDirectory);

        if (
          restoreState.lastFile &&
          audioFiles.some((file) => file.path === restoreState.lastFile)
        ) {
          setSelectedPath(restoreState.lastFile);
        }
      }
    } catch (restoreError: unknown) {
      setBrowserError(String(restoreError));
    }

    setHasLoadedRestoreState(true);
  }

  useEffect(() => {
    if (!hasLoadedRestoreState) {
      return;
    }

    localStorage.setItem("resonix-theme", theme);
    invoke("remember_theme", { theme }).catch((themeError: unknown) => {
      setError(`Could not remember theme: ${String(themeError)}`);
    });
  }, [hasLoadedRestoreState, theme]);

  useEffect(() => {
    const effectiveVolume = isMuted ? 0 : volume * (isDimmed ? 0.3 : 1);
    invoke("set_playback_volume", { volume: effectiveVolume }).catch(
      (volumeError: unknown) => {
        setError(`Could not update volume: ${String(volumeError)}`);
      },
    );
  }, [isDimmed, isMuted, volume]);

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
    if (files.length === 0) {
      return;
    }

    if (!files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0].path);
    }
  }, [files, selectedPath]);

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

  useEffect(() => {
    if (playbackStatus !== "playing" || !playbackAnchor) {
      return;
    }

    const interval = window.setInterval(() => {
      const elapsedSeconds =
        playbackAnchor.offsetSeconds + (Date.now() - playbackAnchor.startedAt) / 1000;
      const duration = selectedFile?.durationSeconds;

      if (duration && duration > 0) {
        if (isLooping) {
          setPlayheadSeconds(elapsedSeconds % duration);
        } else {
          const nextTime = Math.min(elapsedSeconds, duration);
          setPlayheadSeconds(nextTime);

          if (nextTime >= duration) {
            setPlaybackStatus("stopped");
            setPlaybackAnchor(null);
          }
        }
      } else {
        setPlayheadSeconds(elapsedSeconds);
      }
    }, 50);

    return () => window.clearInterval(interval);
  }, [isLooping, playbackAnchor, playbackStatus, selectedFile]);

  useEffect(() => {
    if (visualizerMode !== "spectrum") {
      return;
    }

    let isCancelled = false;

    async function refreshSpectrum() {
      try {
        const bins = await invoke<number[]>("get_spectrum", { binCount: 96 });
        if (!isCancelled) {
          setSpectrumBins(bins);
          setSpectrumError("");
        }
      } catch (spectrumLoadError: unknown) {
        if (!isCancelled) {
          setSpectrumError(String(spectrumLoadError));
        }
      }
    }

    refreshSpectrum();
    const interval = window.setInterval(refreshSpectrum, 50);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [visualizerMode]);

  async function loadDirectory(
    path: string | null,
    cacheKey = path ?? ROOT_KEY,
  ): Promise<AudioFileMetadata[]> {
    const entries = await loadTreeEntries(path, cacheKey);

    if (path) {
      const audioFiles = entries
        .filter((entry) => !entry.isDirectory && entry.audioFile)
        .map((entry) => entry.audioFile as AudioFileMetadata);
      setFiles(audioFiles);
      setCurrentDirectory(path);
      setSelectedPath(audioFiles[0]?.path ?? null);
      setPlayheadSeconds(0);
      setPlaybackAnchor(null);
      setPlaybackStatus("stopped");
      return audioFiles;
    }

    return [];
  }

  async function loadTreeEntries(
    path: string | null,
    cacheKey = path ?? ROOT_KEY,
  ): Promise<FileBrowserEntry[]> {
    setLoadingPaths((paths) => new Set(paths).add(cacheKey));
    setBrowserError("");

    try {
      const entries = await invoke<FileBrowserEntry[]>("list_directory", { path });
      setTreeEntries((previous) => ({ ...previous, [cacheKey]: entries }));
      return entries;
    } catch (directoryError: unknown) {
      setBrowserError(String(directoryError));
      return [];
    } finally {
      setLoadingPaths((paths) => {
        const nextPaths = new Set(paths);
        nextPaths.delete(cacheKey);
        return nextPaths;
      });
    }
  }

  async function loadFavorites(): Promise<AudioFileMetadata[]> {
    try {
      const favorites = await invoke<AudioFileMetadata[]>("list_favorites");
      setFavoriteFiles(favorites);
      return favorites;
    } catch (favoritesError: unknown) {
      setBrowserError(String(favoritesError));
      return [];
    }
  }

  async function showFavorites() {
    const favorites = await loadFavorites();
    setFiles(favorites);
    setCurrentDirectory("Favorites");
    setSelectedPath(favorites[0]?.path ?? null);
    setPlayheadSeconds(0);
    setPlaybackAnchor(null);
    setPlaybackStatus("stopped");
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
    await rememberSelectedFile(file.path);
    await playFile(file, 0);
  }

  async function openContextMenu(
    event: MouseEvent<HTMLElement>,
    file: AudioFileMetadata,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPath(file.path);
    const isFavorite = await invoke<boolean>("is_favorite", {
      filePath: file.path,
    });
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      file,
      isFavorite,
    });
  }

  function prepareNativeFileDrag(
    event: MouseEvent<HTMLTableRowElement>,
    file: AudioFileMetadata,
  ) {
    if (event.button !== 0) {
      return;
    }

    pendingFileDrag.current = {
      file,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  async function maybeStartNativeFileDrag(event: MouseEvent<HTMLTableRowElement>) {
    const pendingDrag = pendingFileDrag.current;

    if (!pendingDrag || (event.buttons & 1) === 0) {
      return;
    }

    const deltaX = event.clientX - pendingDrag.startX;
    const deltaY = event.clientY - pendingDrag.startY;

    if (Math.hypot(deltaX, deltaY) < 6) {
      return;
    }

    event.preventDefault();
    suppressNextFileClick.current = true;
    pendingFileDrag.current = null;

    try {
      await invoke("start_file_drag", { filePath: pendingDrag.file.path });
      setError("");
    } catch (dragError: unknown) {
      setError(`Could not start file drag: ${String(dragError)}`);
    }
  }

  async function rememberSelectedFile(filePath: string) {
    try {
      await invoke("remember_selected_file", { filePath });
    } catch {
      // Selection restore is opportunistic and should not interrupt browsing.
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
    if (files.length === 0) {
      return;
    }

    const selectedIndex = files.findIndex(
      (file) => file.path === selectedPath,
    );
    const nextIndex =
      selectedIndex === -1
        ? 0
        : Math.min(Math.max(selectedIndex + offset, 0), files.length - 1);

    setSelectedPath(files[nextIndex].path);
  }

  async function playSelectedFile() {
    if (!selectedFile) {
      return;
    }

    await playFile(selectedFile, playheadSeconds);
  }

  async function playFile(file: AudioFileMetadata, startSeconds = 0) {
    const normalizedStartSeconds = Math.max(0, startSeconds);

    setPlaybackAnchor(null);
    setPlayheadSeconds(normalizedStartSeconds);
    setPlaybackStatus("playing");

    try {
      await invoke("play_file_with_loop", {
        filePath: file.path,
        loopEnabled: isLooping,
        startSeconds: normalizedStartSeconds,
      });
      setPlaybackAnchor({
        offsetSeconds: normalizedStartSeconds,
        startedAt: Date.now(),
      });
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

  async function toggleFavorite(file: AudioFileMetadata, isFavorite: boolean) {
    try {
      await invoke(isFavorite ? "remove_favorite" : "add_favorite", {
        filePath: file.path,
      });
      await loadFavorites();
      setError("");
    } catch (favoriteError: unknown) {
      setError(`Could not update favorite: ${String(favoriteError)}`);
    }
  }

  async function runContextMenuAction(
    action: "play" | "reveal" | "copy" | "favorite",
  ) {
    if (!contextMenu) {
      return;
    }

    const file = contextMenu.file;
    const wasFavorite = contextMenu.isFavorite;
    setContextMenu(null);

    if (action === "play") {
      setSelectedPath(file.path);
      await rememberSelectedFile(file.path);
      await playFile(file);
      return;
    }

    if (action === "reveal") {
      await revealFile(file);
      return;
    }

    if (action === "copy") {
      await copyFilePath(file);
      return;
    }

    await toggleFavorite(file, wasFavorite);
  }

  async function togglePause() {
    try {
      if (playbackStatus === "playing") {
        await invoke("pause_playback");
        if (playbackAnchor) {
          setPlayheadSeconds(
            playbackAnchor.offsetSeconds +
              (Date.now() - playbackAnchor.startedAt) / 1000,
          );
        }
        setPlaybackAnchor(null);
        setPlaybackStatus("paused");
        return;
      }

      if (playbackStatus === "paused") {
        await invoke("resume_playback");
        setPlaybackAnchor({
          offsetSeconds: playheadSeconds,
          startedAt: Date.now(),
        });
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
      setPlaybackAnchor(null);
      setPlayheadSeconds(0);
    } catch (playbackError: unknown) {
      setError(`Could not stop playback: ${String(playbackError)}`);
    }
  }

  async function toggleLoop() {
    const nextLoopState = !isLooping;
    setIsLooping(nextLoopState);

    if (selectedFile && playbackStatus === "playing") {
      try {
        await invoke("play_file_with_loop", {
          filePath: selectedFile.path,
          loopEnabled: nextLoopState,
          startSeconds: playheadSeconds,
        });
        setPlaybackStatus("playing");
        setPlaybackAnchor({
          offsetSeconds: playheadSeconds,
          startedAt: Date.now(),
        });
        setError("");
      } catch (playbackError: unknown) {
        setPlaybackStatus("stopped");
        setError(`Could not update loop playback: ${String(playbackError)}`);
      }
    }
  }

  async function seekToProgress(progress: number) {
    if (!selectedFile?.durationSeconds) {
      return;
    }

    const nextTime = selectedFile.durationSeconds * progress;
    setPlayheadSeconds(nextTime);
    await playFile(selectedFile, nextTime);
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

      return null;
    });
  }

  return (
    <main className={`app-shell theme-${theme}`} onKeyDown={handleAppKeyDown}>
      <section className="player-region">
        <header className="title-bar">
          <div>
            <span className="app-mark">Resonix</span>
          </div>
          <div className="title-actions">
            <span className="title-status">{playbackStatus}</span>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? (
                <Sun aria-hidden="true" size={17} />
              ) : (
                <Moon aria-hidden="true" size={17} />
              )}
            </button>
          </div>
        </header>

        <section
          className="preview-panel"
          aria-label={
            visualizerMode === "waveform" ? "Waveform preview" : "Spectrum analyzer"
          }
        >
          {visualizerMode === "waveform" ? (
            <WaveformCanvas
              peaks={waveformPeaks}
              playheadProgress={
                selectedFile?.durationSeconds
                  ? playheadSeconds / selectedFile.durationSeconds
                  : 0
              }
              playheadSeconds={playheadSeconds}
              onSeek={seekToProgress}
            />
          ) : (
            <SpectrumCanvas
              bins={spectrumBins}
              isActive={playbackStatus === "playing"}
            />
          )}
          {waveformError && visualizerMode === "waveform" ? (
            <p className="status error visualizer-error">{waveformError}</p>
          ) : null}
          {spectrumError && visualizerMode === "spectrum" ? (
            <p className="status error visualizer-error">{spectrumError}</p>
          ) : null}
        </section>

        <section className="transport-bar" aria-label="Transport controls">
          <div className="transport-file">
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
            <button
              className={`transport-icon-button ${
                visualizerMode === "spectrum" ? "active-transport-icon" : ""
              }`}
              type="button"
              onClick={() =>
                setVisualizerMode((mode) =>
                  mode === "waveform" ? "spectrum" : "waveform",
                )
              }
              aria-pressed={visualizerMode === "spectrum"}
              aria-label={
                visualizerMode === "spectrum"
                  ? "Show waveform view"
                  : "Show spectrum analyzer"
              }
              title={
                visualizerMode === "spectrum"
                  ? "Waveform view"
                  : "Spectrum analyzer"
              }
            >
              <Activity aria-hidden="true" size={20} />
            </button>
            <div className="volume-controls" aria-label="Volume controls">
              <button
                className={`transport-icon-button ${isMuted ? "active-transport-icon" : ""}`}
                type="button"
                onClick={() => setIsMuted((muted) => !muted)}
                aria-pressed={isMuted}
                aria-label={isMuted ? "Unmute playback" : "Mute playback"}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX aria-hidden="true" size={20} />
                ) : volume < 0.5 ? (
                  <Volume1 aria-hidden="true" size={20} />
                ) : (
                  <Volume2 aria-hidden="true" size={20} />
                )}
              </button>
              <input
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => {
                  setVolume(Number(event.currentTarget.value));
                  setIsMuted(false);
                }}
                aria-label="Playback volume"
              />
              <button
                className={`dim-button ${isDimmed ? "active-dim-button" : ""}`}
                type="button"
                onClick={() => setIsDimmed((dimmed) => !dimmed)}
                aria-pressed={isDimmed}
                title={isDimmed ? "Turn dim off" : "Dim volume by 70%"}
              >
                Dim
              </button>
            </div>
          </div>
        </section>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <p className="eyebrow">Browser</p>
          </div>
          <div className="file-tree" aria-label="File browser tree">
            <section className="sidebar-section" aria-label="Favorites">
              <p className="sidebar-section-title">
                <Star size={13} />
                Favorites
              </p>
              <button
                className={`tree-row ${currentDirectory === "Favorites" ? "active-tree-row" : ""}`}
                type="button"
                onClick={showFavorites}
              >
                <Folder size={15} />
                <span>Favorites</span>
                <span className="tree-loading">{favoriteFiles.length}</span>
              </button>
            </section>

            <section className="sidebar-section" aria-label="Drives">
              <p className="sidebar-section-title">
                <HardDrive size={13} />
                Drives
              </p>
            {renderTree(treeEntries[ROOT_KEY])}
            {loadingPaths.has(ROOT_KEY) ? (
              <p className="tree-status">Loading drives...</p>
            ) : null}
            {browserError ? <p className="tree-status error">{browserError}</p> : null}
            </section>
          </div>
        </aside>

        <section className="content">
        <section className="browser-toolbar" aria-label="File browser controls">
          <div className="browser-summary">
            <span>
              {files.length.toLocaleString()}{" "}
              {currentDirectory === "Favorites" ? "favorites" : "in folder"}
            </span>
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
        <div
          className="table-wrap"
          onKeyDown={handleBrowserKeyDown}
          role="region"
          aria-label="Audio files in selected folder"
        >
          <table>
            <thead>
              <tr>
                <th className="waveform-thumbnail-heading">Wave</th>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Duration</th>
                <th>Sample Rate</th>
                <th>Channels</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  className={file.path === selectedPath ? "selected-row" : ""}
                  key={file.path}
                  data-file-drag-source="true"
                  tabIndex={0}
                  aria-selected={file.path === selectedPath}
                  onContextMenu={(event) => openContextMenu(event, file)}
                  onMouseDown={(event) => prepareNativeFileDrag(event, file)}
                  onMouseMove={maybeStartNativeFileDrag}
                  onMouseUp={() => {
                    pendingFileDrag.current = null;
                  }}
                  onClick={() => {
                    if (suppressNextFileClick.current) {
                      suppressNextFileClick.current = false;
                      return;
                    }

                    setSelectedPath(file.path);
                    rememberSelectedFile(file.path);
                    playFile(file, 0);
                  }}
                  onFocus={() => setSelectedPath(file.path)}
                >
                  <td className="waveform-thumbnail-cell">
                    <WaveformThumbnail filePath={file.path} />
                  </td>
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
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextMenuAction("favorite")}
          >
            {contextMenu.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default App;
