mod audio;
mod commands;
mod library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio::playback::PlaybackController::new())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::list_directory,
            commands::play_file,
            commands::play_file_with_loop,
            commands::pause_playback,
            commands::resume_playback,
            commands::stop_playback,
            commands::generate_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
