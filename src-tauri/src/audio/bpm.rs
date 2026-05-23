use std::{fs::File, path::Path};

use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

const MAX_ANALYSIS_SECONDS: f64 = 60.0;
const HOP_SIZE: usize = 1024;
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 200.0;

pub fn detect_bpm(path: &Path) -> Option<f64> {
    let decoded = decode_mono_samples(path, MAX_ANALYSIS_SECONDS).ok()?;
    estimate_bpm(&decoded.samples, decoded.sample_rate)
}

struct DecodedAudio {
    samples: Vec<f32>,
    sample_rate: u32,
}

fn decode_mono_samples(path: &Path, max_seconds: f64) -> Result<DecodedAudio, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
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
    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| "Audio sample rate is unavailable.".to_string())?;

    let mut decoder = symphonia::default::get_codecs()
        .make(codec_params, &DecoderOptions::default())
        .map_err(|error| error.to_string())?;
    let max_sample_count = (sample_rate as f64 * max_seconds) as usize;
    let mut mono_samples = Vec::new();

    loop {
        if mono_samples.len() >= max_sample_count {
            break;
        }

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

        let spec = *decoded.spec();
        let channel_count = spec.channels.count().max(1);
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);

        for frame in buffer.samples().chunks(channel_count) {
            if mono_samples.len() >= max_sample_count {
                break;
            }

            let mono = frame.iter().copied().sum::<f32>() / frame.len() as f32;
            mono_samples.push(mono);
        }
    }

    Ok(DecodedAudio {
        samples: mono_samples,
        sample_rate,
    })
}

fn estimate_bpm(samples: &[f32], sample_rate: u32) -> Option<f64> {
    if samples.len() < sample_rate as usize * 4 {
        return None;
    }

    let envelope = energy_envelope(samples);
    if envelope.len() < 32 {
        return None;
    }

    let novelty = onset_novelty(&envelope);
    let envelope_rate = sample_rate as f64 / HOP_SIZE as f64;
    let min_lag = (envelope_rate * 60.0 / MAX_BPM).round().max(1.0) as usize;
    let max_lag = (envelope_rate * 60.0 / MIN_BPM).round() as usize;

    if max_lag <= min_lag || novelty.len() <= max_lag {
        return None;
    }

    let mut best_lag = 0;
    let mut best_score = 0.0_f32;
    let mut score_sum = 0.0_f32;
    let mut score_count = 0;

    for lag in min_lag..=max_lag {
        let score = autocorrelation_score(&novelty, lag);
        score_sum += score;
        score_count += 1;

        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    if best_lag == 0 || score_count == 0 {
        return None;
    }

    let average_score = score_sum / score_count as f32;
    if best_score < 0.0008 || best_score < average_score * 1.2 {
        return None;
    }

    let mut bpm = 60.0 * envelope_rate / best_lag as f64;
    while bpm < 80.0 {
        bpm *= 2.0;
    }
    while bpm > 180.0 {
        bpm /= 2.0;
    }

    Some((bpm * 10.0).round() / 10.0)
}

fn energy_envelope(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(HOP_SIZE)
        .map(|chunk| {
            let energy = chunk.iter().map(|sample| sample * sample).sum::<f32>();
            (energy / chunk.len() as f32).sqrt()
        })
        .collect()
}

fn onset_novelty(envelope: &[f32]) -> Vec<f32> {
    let mean = envelope.iter().copied().sum::<f32>() / envelope.len() as f32;
    let variance = envelope
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f32>()
        / envelope.len() as f32;
    let deviation = variance.sqrt().max(0.000001);

    envelope
        .windows(2)
        .map(|pair| ((pair[1] - pair[0]) / deviation).max(0.0))
        .collect()
}

fn autocorrelation_score(values: &[f32], lag: usize) -> f32 {
    let usable_len = values.len().saturating_sub(lag);
    if usable_len == 0 {
        return 0.0;
    }

    let score = values
        .iter()
        .take(usable_len)
        .zip(values.iter().skip(lag))
        .map(|(left, right)| left * right)
        .sum::<f32>();

    score / usable_len as f32
}
