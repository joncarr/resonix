use std::{
    fs::File,
    path::{Path, PathBuf},
};

use symphonia::core::{
    codecs::CODEC_TYPE_NULL, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions,
    probe::Hint,
};
use walkdir::WalkDir;

use crate::library::metadata::AudioFileMetadata;

const SUPPORTED_EXTENSIONS: &[&str] = &["wav", "mp3", "flac", "ogg"];

pub fn scan_audio_folder(folder_path: &str) -> Result<Vec<AudioFileMetadata>, String> {
    let root = Path::new(folder_path);

    if !root.exists() {
        return Err("Folder path does not exist.".to_string());
    }

    if !root.is_dir() {
        return Err("Path must point to a folder.".to_string());
    }

    let mut files = Vec::new();

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !entry.file_type().is_file() || !is_supported_audio_file(path) {
            continue;
        }

        files.push(read_audio_metadata(path)?);
    }

    files.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(files)
}

pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
        .unwrap_or(false)
}

pub fn read_audio_metadata(path: &Path) -> Result<AudioFileMetadata, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase();

    let audio_details = probe_audio_details(path).unwrap_or_default();

    Ok(AudioFileMetadata {
        filename,
        path: normalize_path(path),
        extension,
        file_size: metadata.len(),
        duration_seconds: audio_details.duration_seconds,
        sample_rate: audio_details.sample_rate,
        channel_count: audio_details.channel_count,
    })
}

pub fn normalize_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

#[derive(Default)]
struct AudioDetails {
    duration_seconds: Option<f64>,
    sample_rate: Option<u32>,
    channel_count: Option<usize>,
}

fn probe_audio_details(path: &Path) -> Option<AudioDetails> {
    let file = File::open(path).ok()?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }

    // Symphonia reads container headers here; it does not decode the whole file.
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;

    let track = probed
        .format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)?;

    let sample_rate = track.codec_params.sample_rate;
    let channel_count = track.codec_params.channels.map(|channels| channels.count());
    let duration_seconds = track
        .codec_params
        .n_frames
        .zip(sample_rate)
        .map(|(frames, sample_rate)| frames as f64 / sample_rate as f64);

    Some(AudioDetails {
        duration_seconds,
        sample_rate,
        channel_count,
    })
}
