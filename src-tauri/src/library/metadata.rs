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
