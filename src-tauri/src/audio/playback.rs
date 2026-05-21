use std::{
    fs::File,
    io::BufReader,
    sync::mpsc::{self, Sender},
    thread,
};

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};

pub struct PlaybackController {
    sender: Sender<PlaybackCommand>,
}

enum PlaybackCommand {
    Play {
        file_path: String,
        loop_enabled: bool,
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
                        reply,
                    } => {
                        let _ = reply.send(playback.play_file(&file_path, loop_enabled));
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
                }
            }
        });

        Self { sender }
    }

    pub fn play_file(&self, file_path: String, loop_enabled: bool) -> Result<(), String> {
        self.send_command(|reply| PlaybackCommand::Play {
            file_path,
            loop_enabled,
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
}

impl PlaybackManager {
    pub fn new() -> Self {
        Self {
            stream: None,
            handle: None,
            sink: None,
        }
    }

    pub fn play_file(&mut self, file_path: &str, loop_enabled: bool) -> Result<(), String> {
        self.stop();
        self.ensure_output_stream()?;

        let file = File::open(file_path).map_err(|error| error.to_string())?;
        let source = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        let handle = self
            .handle
            .as_ref()
            .ok_or_else(|| "Playback output is unavailable.".to_string())?;
        let sink = Sink::try_new(handle).map_err(|error| error.to_string())?;

        if loop_enabled {
            sink.append(source.repeat_infinite());
        } else {
            sink.append(source);
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
