use std::{
    fs::File,
    io::BufReader,
    sync::mpsc::{self, Sender},
    thread,
    time::Duration,
};

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};

pub struct PlaybackController {
    sender: Sender<PlaybackCommand>,
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

        thread::spawn(move || {
            let mut playback = PlaybackManager::new();

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

        Self { sender }
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
}

impl PlaybackManager {
    pub fn new() -> Self {
        Self {
            stream: None,
            handle: None,
            sink: None,
            volume: 1.0,
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
        let handle = self
            .handle
            .as_ref()
            .ok_or_else(|| "Playback output is unavailable.".to_string())?;
        let sink = Sink::try_new(handle).map_err(|error| error.to_string())?;
        sink.set_volume(self.volume);
        let start = Duration::from_secs_f64(start_seconds.max(0.0));

        if loop_enabled {
            if start.is_zero() {
                sink.append(source.repeat_infinite());
            } else {
                let loop_file = File::open(file_path).map_err(|error| error.to_string())?;
                let loop_source =
                    Decoder::new(BufReader::new(loop_file)).map_err(|error| error.to_string())?;

                sink.append(source.skip_duration(start));
                sink.append(loop_source.repeat_infinite());
            }
        } else {
            sink.append(source.skip_duration(start));
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
