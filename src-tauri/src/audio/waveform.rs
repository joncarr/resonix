use std::fs::File;

use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

const DEFAULT_PEAK_COUNT: usize = 512;
const MAX_PEAK_COUNT: usize = 4096;

pub fn generate_waveform_peaks(
    file_path: &str,
    peak_count: Option<usize>,
) -> Result<Vec<f32>, String> {
    let requested_peak_count = peak_count
        .unwrap_or(DEFAULT_PEAK_COUNT)
        .clamp(1, MAX_PEAK_COUNT);
    let samples = decode_samples(file_path)?;

    if samples.is_empty() {
        return Ok(vec![0.0; requested_peak_count]);
    }

    Ok(samples_to_peaks(&samples, requested_peak_count))
}

fn decode_samples(file_path: &str) -> Result<Vec<f32>, String> {
    let file = File::open(file_path).map_err(|error| error.to_string())?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = std::path::Path::new(file_path)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| error.to_string())?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "No supported audio track found.".to_string())?;
    let track_id = track.id;
    let codec_params = &track.codec_params;

    let mut decoder = symphonia::default::get_codecs()
        .make(codec_params, &DecoderOptions::default())
        .map_err(|error| error.to_string())?;

    let mut samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(_)) | Err(Error::ResetRequired) => break,
            Err(error) => return Err(error.to_string()),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        };

        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buffer.copy_interleaved_ref(decoded);
        samples.extend_from_slice(buffer.samples());
    }

    Ok(samples)
}

fn samples_to_peaks(samples: &[f32], peak_count: usize) -> Vec<f32> {
    let samples_per_peak = (samples.len() as f32 / peak_count as f32).ceil() as usize;
    let samples_per_peak = samples_per_peak.max(1);
    let mut peaks = Vec::with_capacity(peak_count);

    for chunk in samples.chunks(samples_per_peak).take(peak_count) {
        let peak = chunk
            .iter()
            .map(|sample| sample.abs())
            .fold(0.0_f32, f32::max);
        peaks.push(peak);
    }

    peaks.resize(peak_count, 0.0);

    let max_peak = peaks.iter().copied().fold(0.0_f32, f32::max);
    if max_peak > 0.0 {
        for peak in &mut peaks {
            *peak /= max_peak;
        }
    }

    peaks
}
