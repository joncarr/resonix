use std::{fs, path::Path};

use crate::library::{
    database::CacheDatabase,
    metadata::FileBrowserEntry,
    scanner::{is_supported_audio_file, normalize_path, read_audio_metadata},
};

pub fn list_directory(
    path: Option<String>,
    database: Option<&CacheDatabase>,
) -> Result<Vec<FileBrowserEntry>, String> {
    match path {
        Some(path) => list_directory_entries(Path::new(&path), database),
        None => Ok(list_roots()),
    }
}

fn list_roots() -> Vec<FileBrowserEntry> {
    #[cfg(windows)]
    {
        ('A'..='Z')
            .filter_map(|letter| {
                let path = format!("{letter}:\\");
                Path::new(&path).exists().then(|| FileBrowserEntry {
                    name: path.clone(),
                    path,
                    is_directory: true,
                    audio_file: None,
                })
            })
            .collect()
    }

    #[cfg(not(windows))]
    {
        vec![FileBrowserEntry {
            name: "/".to_string(),
            path: "/".to_string(),
            is_directory: true,
            audio_file: None,
        }]
    }
}

fn list_directory_entries(
    path: &Path,
    database: Option<&CacheDatabase>,
) -> Result<Vec<FileBrowserEntry>, String> {
    if !path.exists() {
        return Err("Directory path does not exist.".to_string());
    }

    if !path.is_dir() {
        return Err("Path must point to a directory.".to_string());
    }

    let mut directories = Vec::new();
    let mut audio_files = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if file_type.is_dir() {
            directories.push(FileBrowserEntry {
                name,
                path: normalize_path(&path),
                is_directory: true,
                audio_file: None,
            });
        } else if file_type.is_file() && is_supported_audio_file(&path) {
            let metadata = if let Some(database) = database {
                database.metadata_for_path(&path, || read_audio_metadata(&path))?
            } else {
                read_audio_metadata(&path)?
            };

            audio_files.push(FileBrowserEntry {
                name,
                path: normalize_path(&path),
                is_directory: false,
                audio_file: Some(metadata),
            });
        }
    }

    directories.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    audio_files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    directories.extend(audio_files);

    Ok(directories)
}
