use std::{
    fs::File,
    io::BufReader,
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sample, Sink, Source};

pub struct PlaybackController {
    sender: Sender<PlaybackCommand>,
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
}

enum PlaybackCommand {
    Play {
        file_path: String,
        loop_enabled: bool,
        start_seconds: f64,
        reply: Sender<Result<(), String>>,
    },
    Pause {
        reply: Sender<Result<(), String>>,
    },
    Resume {
        reply: Sender<Result<(), String>>,
    },
    Stop {
        reply: Sender<Result<(), String>>,
    },
    SetVolume {
        volume: f32,
        reply: Sender<Result<(), String>>,
    },
}

impl PlaybackController {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        let analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::new()));
        let playback_analyzer = Arc::clone(&analyzer);

        thread::spawn(move || {
            let mut playback = PlaybackManager::new(playback_analyzer);

            while let Ok(command) = receiver.recv() {
                match command {
                    PlaybackCommand::Play {
                        file_path,
                        loop_enabled,
                        start_seconds,
                        reply,
                    } => {
                        let _ =
                            reply.send(playback.play_file(&file_path, loop_enabled, start_seconds));
                    }
                    PlaybackCommand::Pause { reply } => {
                        playback.pause();
                        let _ = reply.send(Ok(()));
                    }
                    PlaybackCommand::Resume { reply } => {
                        playback.resume();
                        let _ = reply.send(Ok(()));
                    }
                    PlaybackCommand::Stop { reply } => {
                        playback.stop();
                        let _ = reply.send(Ok(()));
                    }
                    PlaybackCommand::SetVolume { volume, reply } => {
                        playback.set_volume(volume);
                        let _ = reply.send(Ok(()));
                    }
                }
            }
        });

        Self { sender, analyzer }
    }

    pub fn play_file(
        &self,
        file_path: String,
        loop_enabled: bool,
        start_seconds: f64,
    ) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::Play {
            file_path,
            loop_enabled,
            start_seconds,
            reply,
        })
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::Pause { reply })
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::Resume { reply })
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::Stop { reply })
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::SetVolume { volume, reply })
    }

    pub fn spectrum_bins(&self, bin_count: usize) -> Result<Vec<f32>, String> {
        self.analyzer
            .lock()
            .map_err(|_| "Spectrum analyzer state is unavailable.".to_string())
            .map(|analyzer| analyzer.spectrum_bins(bin_count))
    }

    fn send_command(
        &self,
        build_command: impl FnOnce(Sender<Result<(), String>>) -> PlaybackCommand,
    ) -> Result<(), String> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(build_command(reply))
            .map_err(|error| error.to_string())?;
        response.recv().map_err(|error| error.to_string())?
    }
}

struct PlaybackManager {
    stream: Option<OutputStream>,
    handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    volume: f32,
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
}

impl PlaybackManager {
    pub fn new(analyzer: Arc<Mutex<SpectrumAnalyzer>>) -> Self {
        Self {
            stream: None,
            handle: None,
            sink: None,
            volume: 1.0,
            analyzer,
        }
    }

    pub fn play_file(
        &mut self,
        file_path: &str,
        loop_enabled: bool,
        start_seconds: f64,
    ) -> Result<(), String> {
        self.stop();
        self.ensure_output_stream()?;

        let file = File::open(file_path).map_err(|error| error.to_string())?;
        let source = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        let sample_rate = source.sample_rate();
        let channel_count = source.channels();
        if let Ok(mut analyzer) = self.analyzer.lock() {
            analyzer.reset(sample_rate, channel_count);
        }

        let handle = self
            .handle
            .as_ref()
            .ok_or_else(|| "Playback output is unavailable.".to_string())?;
        let sink = Sink::try_new(handle).map_err(|error| error.to_string())?;
        sink.set_volume(self.volume);
        let start = Duration::from_secs_f64(start_seconds.max(0.0));

        if loop_enabled {
            if start.is_zero() {
                sink.append(AnalyzedSource::new(
                    source.repeat_infinite(),
                    Arc::clone(&self.analyzer),
                ));
            } else {
                let loop_file = File::open(file_path).map_err(|error| error.to_string())?;
                let loop_source =
                    Decoder::new(BufReader::new(loop_file)).map_err(|error| error.to_string())?;

                sink.append(AnalyzedSource::new(
                    source.skip_duration(start),
                    Arc::clone(&self.analyzer),
                ));
                sink.append(AnalyzedSource::new(
                    loop_source.repeat_infinite(),
                    Arc::clone(&self.analyzer),
                ));
            }
        } else {
            sink.append(AnalyzedSource::new(
                source.skip_duration(start),
                Arc::clone(&self.analyzer),
            ));
        }

        self.sink = Some(sink);

        Ok(())
    }

    pub fn pause(&self) {
        if let Some(sink) = &self.sink {
            sink.pause();
        }
    }

    pub fn resume(&self) {
        if let Some(sink) = &self.sink {
            sink.play();
        }
    }

    pub fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        if let Ok(mut analyzer) = self.analyzer.lock() {
            analyzer.clear();
        }
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);

        if let Some(sink) = &self.sink {
            sink.set_volume(self.volume);
        }
    }

    fn ensure_output_stream(&mut self) -> Result<(), String> {
        if self.handle.is_none() {
            let (stream, handle) =
                OutputStream::try_default().map_err(|error| error.to_string())?;
            self.stream = Some(stream);
            self.handle = Some(handle);
        }

        Ok(())
    }
}

struct AnalyzedSource<S> {
    source: S,
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
}

impl<S> AnalyzedSource<S> {
    fn new(source: S, analyzer: Arc<Mutex<SpectrumAnalyzer>>) -> Self {
        Self { source, analyzer }
    }
}

impl<S> Iterator for AnalyzedSource<S>
where
    S: Source,
    S::Item: Sample + Copy + Into<f32>,
{
    type Item = S::Item;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.source.next()?;
        if let Ok(mut analyzer) = self.analyzer.lock() {
            analyzer.push_interleaved_sample(sample.into());
        }
        Some(sample)
    }
}

impl<S> Source for AnalyzedSource<S>
where
    S: Source,
    S::Item: Sample + Copy + Into<f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.source.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.source.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.source.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.source.total_duration()
    }
}

struct SpectrumAnalyzer {
    samples: Vec<f32>,
    write_index: usize,
    filled: bool,
    channel_count: u16,
    sample_rate: u32,
    channel_index: u16,
    mono_accumulator: f32,
}

impl SpectrumAnalyzer {
    const WINDOW_SIZE: usize = 2048;

    fn new() -> Self {
        Self {
            samples: vec![0.0; Self::WINDOW_SIZE],
            write_index: 0,
            filled: false,
            channel_count: 1,
            sample_rate: 44_100,
            channel_index: 0,
            mono_accumulator: 0.0,
        }
    }

    fn reset(&mut self, sample_rate: u32, channel_count: u16) {
        self.clear();
        self.sample_rate = sample_rate.max(1);
        self.channel_count = channel_count.max(1);
    }

    fn clear(&mut self) {
        self.samples.fill(0.0);
        self.write_index = 0;
        self.filled = false;
        self.channel_index = 0;
        self.mono_accumulator = 0.0;
    }

    fn push_interleaved_sample(&mut self, sample: f32) {
        self.mono_accumulator += sample;
        self.channel_index += 1;

        if self.channel_index < self.channel_count {
            return;
        }

        let mono_sample = self.mono_accumulator / self.channel_count as f32;
        self.samples[self.write_index] = mono_sample;
        self.write_index = (self.write_index + 1) % Self::WINDOW_SIZE;
        self.filled |= self.write_index == 0;
        self.channel_index = 0;
        self.mono_accumulator = 0.0;
    }

    fn ordered_samples(&self) -> Vec<f32> {
        if self.filled {
            let mut ordered = self.samples[self.write_index..].to_vec();
            ordered.extend_from_slice(&self.samples[..self.write_index]);
            ordered
        } else {
            self.samples[..self.write_index].to_vec()
        }
    }

    fn spectrum_bins(&self, bin_count: usize) -> Vec<f32> {
        let bin_count = bin_count.clamp(16, 192);
        let samples = self.ordered_samples();

        if samples.len() < 64 {
            return vec![0.0; bin_count];
        }

        let nyquist = self.sample_rate as f32 / 2.0;
        let min_frequency = 24.0_f32;
        let max_frequency = nyquist.min(20_000.0).max(min_frequency * 2.0);
        let mut magnitudes = Vec::with_capacity(bin_count);

        for index in 0..bin_count {
            let position = index as f32 / (bin_count.saturating_sub(1).max(1)) as f32;
            let frequency = min_frequency * (max_frequency / min_frequency).powf(position);
            magnitudes.push(self.frequency_magnitude(&samples, frequency));
        }

        let max_magnitude = magnitudes.iter().copied().fold(0.0_f32, f32::max);
        if max_magnitude > 0.0 {
            for magnitude in &mut magnitudes {
                *magnitude = (*magnitude / max_magnitude).sqrt().clamp(0.0, 1.0);
            }
        }

        magnitudes
    }

    fn frequency_magnitude(&self, samples: &[f32], frequency: f32) -> f32 {
        let sample_count = samples.len() as f32;
        let angular_step = std::f32::consts::TAU * frequency / self.sample_rate as f32;
        let mut real = 0.0_f32;
        let mut imaginary = 0.0_f32;

        for (index, sample) in samples.iter().enumerate() {
            let window = 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / sample_count).cos();
            let angle = angular_step * index as f32;
            real += sample * window * angle.cos();
            imaginary -= sample * window * angle.sin();
        }

        (real.mul_add(real, imaginary * imaginary).sqrt()) / sample_count
    }
}
