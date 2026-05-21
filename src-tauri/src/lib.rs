mod audio;
mod commands;
mod library;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio::playback::PlaybackController::new())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let database = library::database::CacheDatabase::new(app_data_dir)
                .map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::list_directory,
            commands::list_favorites,
            commands::add_favorite,
            commands::remove_favorite,
            commands::is_favorite,
            commands::list_recent_folders,
            commands::restore_app_state,
            commands::remember_selected_file,
            commands::remember_theme,
            commands::play_file,
            commands::play_file_with_loop,
            commands::pause_playback,
            commands::resume_playback,
            commands::stop_playback,
            commands::set_playback_volume,
            commands::generate_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
