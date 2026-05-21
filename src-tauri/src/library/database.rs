use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use rusqlite::{params, Connection, OptionalExtension};

use crate::library::metadata::AudioFileMetadata;

#[derive(Clone)]
pub struct CacheDatabase {
    db_path: PathBuf,
}

#[derive(Debug, Clone, Copy)]
pub struct FileFingerprint {
    pub file_size: u64,
    pub modified_time: i64,
}

impl CacheDatabase {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        let db_path = app_data_dir.join("resonix-cache.sqlite3");
        let database = Self { db_path };
        database.initialize()?;
        Ok(database)
    }

    pub fn metadata_for_path(
        &self,
        path: &Path,
        read_metadata: impl FnOnce() -> Result<AudioFileMetadata, String>,
    ) -> Result<AudioFileMetadata, String> {
        let normalized_path = path.to_string_lossy().to_string();
        let fingerprint = fingerprint(path)?;

        if let Some(metadata) = self.cached_metadata(&normalized_path, fingerprint)? {
            return Ok(metadata);
        }

        let metadata = read_metadata()?;
        self.store_metadata(&metadata, fingerprint)?;
        Ok(metadata)
    }

    pub fn waveform_for_path(
        &self,
        path: &str,
        peak_count: usize,
        generate_waveform: impl FnOnce() -> Result<Vec<f32>, String>,
    ) -> Result<Vec<f32>, String> {
        let fingerprint = fingerprint(Path::new(path))?;

        if let Some(peaks) = self.cached_waveform(path, fingerprint, peak_count)? {
            return Ok(peaks);
        }

        let peaks = generate_waveform()?;
        self.store_waveform(path, fingerprint, peak_count, &peaks)?;
        Ok(peaks)
    }

    fn initialize(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS audio_metadata (
                    path TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    modified_time INTEGER NOT NULL,
                    duration_seconds REAL,
                    sample_rate INTEGER,
                    channel_count INTEGER,
                    cached_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS waveform_cache (
                    path TEXT NOT NULL,
                    peak_count INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    modified_time INTEGER NOT NULL,
                    peaks_json TEXT NOT NULL,
                    cached_at INTEGER NOT NULL,
                    PRIMARY KEY (path, peak_count)
                );

                CREATE TABLE IF NOT EXISTS favorites (
                    path TEXT PRIMARY KEY,
                    added_at INTEGER NOT NULL
                );
                ",
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn cached_metadata(
        &self,
        path: &str,
        fingerprint: FileFingerprint,
    ) -> Result<Option<AudioFileMetadata>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "
                SELECT filename, extension, file_size, duration_seconds, sample_rate, channel_count
                FROM audio_metadata
                WHERE path = ?1 AND file_size = ?2 AND modified_time = ?3
                ",
                params![path, fingerprint.file_size, fingerprint.modified_time],
                |row| {
                    Ok(AudioFileMetadata {
                        filename: row.get(0)?,
                        path: path.to_string(),
                        extension: row.get(1)?,
                        file_size: row.get::<_, i64>(2)? as u64,
                        duration_seconds: row.get(3)?,
                        sample_rate: row.get::<_, Option<i64>>(4)?.map(|value| value as u32),
                        channel_count: row.get::<_, Option<i64>>(5)?.map(|value| value as usize),
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn store_metadata(
        &self,
        metadata: &AudioFileMetadata,
        fingerprint: FileFingerprint,
    ) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute(
                "
                INSERT INTO audio_metadata (
                    path, filename, extension, file_size, modified_time, duration_seconds,
                    sample_rate, channel_count, cached_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%s', 'now'))
                ON CONFLICT(path) DO UPDATE SET
                    filename = excluded.filename,
                    extension = excluded.extension,
                    file_size = excluded.file_size,
                    modified_time = excluded.modified_time,
                    duration_seconds = excluded.duration_seconds,
                    sample_rate = excluded.sample_rate,
                    channel_count = excluded.channel_count,
                    cached_at = excluded.cached_at
                ",
                params![
                    metadata.path,
                    metadata.filename,
                    metadata.extension,
                    metadata.file_size,
                    fingerprint.modified_time,
                    metadata.duration_seconds,
                    metadata.sample_rate.map(i64::from),
                    metadata.channel_count.map(|value| value as i64),
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn cached_waveform(
        &self,
        path: &str,
        fingerprint: FileFingerprint,
        peak_count: usize,
    ) -> Result<Option<Vec<f32>>, String> {
        let connection = self.connection()?;
        let peaks_json: Option<String> = connection
            .query_row(
                "
                SELECT peaks_json
                FROM waveform_cache
                WHERE path = ?1 AND peak_count = ?2 AND file_size = ?3 AND modified_time = ?4
                ",
                params![
                    path,
                    peak_count as i64,
                    fingerprint.file_size,
                    fingerprint.modified_time
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        peaks_json
            .map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
            .transpose()
    }

    fn store_waveform(
        &self,
        path: &str,
        fingerprint: FileFingerprint,
        peak_count: usize,
        peaks: &[f32],
    ) -> Result<(), String> {
        let connection = self.connection()?;
        let peaks_json = serde_json::to_string(peaks).map_err(|error| error.to_string())?;
        connection
            .execute(
                "
                INSERT INTO waveform_cache (
                    path, peak_count, file_size, modified_time, peaks_json, cached_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
                ON CONFLICT(path, peak_count) DO UPDATE SET
                    file_size = excluded.file_size,
                    modified_time = excluded.modified_time,
                    peaks_json = excluded.peaks_json,
                    cached_at = excluded.cached_at
                ",
                params![
                    path,
                    peak_count as i64,
                    fingerprint.file_size,
                    fingerprint.modified_time,
                    peaks_json
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn connection(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }
}

pub fn fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    let modified_time = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    Ok(FileFingerprint {
        file_size: metadata.len(),
        modified_time,
    })
}
