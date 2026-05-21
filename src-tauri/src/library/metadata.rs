use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileMetadata {
    pub filename: String,
    pub path: String,
    pub extension: String,
    pub file_size: u64,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channel_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBrowserEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub audio_file: Option<AudioFileMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRestoreState {
    pub last_directory: Option<String>,
    pub last_file: Option<String>,
    pub theme: Option<String>,
}
