use tauri::State;

use crate::{
    audio::{playback::PlaybackController, waveform},
    library::{
        browser,
        database::CacheDatabase,
        metadata::{AudioFileMetadata, FileBrowserEntry},
        scanner,
    },
};

#[tauri::command]
pub async fn scan_folder(
    folder_path: String,
    database: State<'_, CacheDatabase>,
) -> Result<Vec<AudioFileMetadata>, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_audio_folder_with_cache(&folder_path, Some(&database))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_directory(
    path: Option<String>,
    database: State<'_, CacheDatabase>,
) -> Result<Vec<FileBrowserEntry>, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || browser::list_directory(path, Some(&database)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn play_file(file_path: String, playback: State<'_, PlaybackController>) -> Result<(), String> {
    playback.play_file(file_path, false, 0.0)
}

#[tauri::command]
pub fn play_file_with_loop(
    file_path: String,
    loop_enabled: bool,
    start_seconds: Option<f64>,
    playback: State<'_, PlaybackController>,
) -> Result<(), String> {
    playback.play_file(file_path, loop_enabled, start_seconds.unwrap_or(0.0))
}

#[tauri::command]
pub fn pause_playback(playback: State<'_, PlaybackController>) -> Result<(), String> {
    playback.pause()
}

#[tauri::command]
pub fn resume_playback(playback: State<'_, PlaybackController>) -> Result<(), String> {
    playback.resume()
}

#[tauri::command]
pub fn stop_playback(playback: State<'_, PlaybackController>) -> Result<(), String> {
    playback.stop()
}

#[tauri::command]
pub async fn generate_waveform(
    file_path: String,
    peak_count: Option<usize>,
    database: State<'_, CacheDatabase>,
) -> Result<Vec<f32>, String> {
    let database = database.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        waveform::generate_waveform_peaks_with_cache(&file_path, peak_count, Some(&database))
    })
    .await
    .map_err(|error| error.to_string())?
}
