use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};
use crate::flash::orchestrator::{FlashProgress, FlashStage, FirmwareFormat, ToolSource};
use crate::tools::managed::ManagedTool;
use crate::tools::runner::{self, hidden_command};

pub struct Avrdude {
    pub executable: PathBuf,
    config: Option<PathBuf>,
}

impl Avrdude {
    fn managed(runtime: &Path) -> Self {
        Self {
            executable: runtime.join("avrdude.exe"),
            config: Some(runtime.join("avrdude.conf")),
        }
    }

    fn command(&self) -> Command {
        let mut cmd = hidden_command(&self.executable);
        if let Some(config) = &self.config {
            cmd.arg("-C").arg(config).arg("-N");
        }
        cmd
    }

    fn probe(&self) -> Option<String> {
        let (_, output) = runner::capture({
            let mut cmd = self.command();
            cmd.args(["-v", "-p", "?"]);
            cmd
        })?;
        // AVRDUDE exits 1 after listing parts, including when the config could not be read.
        if !output.lines().any(|line| line.trim_end().ends_with("Valid parts are:")) {
            return None;
        }
        let version = output.lines().find(|line| line.to_ascii_lowercase().contains("avrdude version"));
        Some(version.unwrap_or_default().trim().into())
    }
}

pub fn validate_runtime(runtime: &Path) -> AppResult<()> {
    Avrdude::managed(runtime).probe().map(|_| ()).ok_or_else(|| {
        AppError::Generic("AVRDUDE could not load its configuration and list the supported chips".into())
    })
}

pub fn resolve_tool(tools_dir: &Path) -> Option<(Avrdude, String, ToolSource)> {
    let runtime = ManagedTool::Avrdude.path(tools_dir);
    let managed = runtime.is_dir().then(|| (Avrdude::managed(&runtime), ToolSource::Managed));
    let system = runner::path_candidates("avrdude")
        .map(|executable| (Avrdude { executable, config: None }, ToolSource::System));
    managed.into_iter().chain(system).find_map(|(tool, source)| {
        tool.probe().map(|version| (tool, version, source))
    })
}

pub struct AvrdudeConfig {
    pub programmer: String,
    pub part: String,
    pub port: String,
    pub baud_rate: u32,
}

impl AvrdudeConfig {
    pub fn arduino(part: &str, port: &str) -> Self {
        Self {
            programmer: "arduino".into(),
            part: part.to_string(),
            port: port.to_string(),
            baud_rate: 115200,
        }
    }
}

pub struct AvrdudeFlasher {
    tool: Avrdude,
    cancel_flag: Arc<AtomicBool>,
}

impl AvrdudeFlasher {
    pub fn new(tool: Avrdude, cancel_flag: Arc<AtomicBool>) -> Self {
        Self { tool, cancel_flag }
    }

    pub async fn flash(
        &self,
        config: &AvrdudeConfig,
        firmware: &[u8],
        format: &FirmwareFormat,
        progress: mpsc::Sender<FlashProgress>,
    ) -> AppResult<()> {
        let tmp = tempfile::Builder::new()
            .prefix("serial-helper-avr-")
            .suffix(extension_for(format))
            .tempfile()
            .map_err(|e| AppError::Generic(format!("Cannot create temp file: {}", e)))?;

        tmp.as_file()
            .write_all(firmware)
            .map_err(|e| AppError::Generic(format!("Cannot write temp firmware: {}", e)))?;

        let tmp_path = tmp.path().to_string_lossy().to_string();

        let result = self
            .run_avrdude(config, &tmp_path, &progress)
            .await;

        let _ = tmp.close();
        result
    }

    async fn run_avrdude(
        &self,
        config: &AvrdudeConfig,
        firmware_path: &str,
        progress: &mpsc::Sender<FlashProgress>,
    ) -> AppResult<()> {
        let mem_type = format!("flash:w:{}:i", firmware_path);

        let mut cmd = self.tool.command();
        cmd.arg("-c").arg(&config.programmer);
        cmd.arg("-p").arg(&config.part);
        cmd.arg("-P").arg(&config.port);
        cmd.arg("-b").arg(config.baud_rate.to_string());
        cmd.arg("-U").arg(&mem_type);
        cmd.arg("-v");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|_e| AppError::ToolNotFound {
                tool: "avrdude".into(),
                install_cmd: "Download from https://github.com/avrdudes/avrdude/releases".into(),
            })?;

        let cancel_flag = self.cancel_flag.clone();
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Generic("Cannot capture avrdude stderr".into()))?;

        // Spawn a task to read stderr and parse progress + log
        let progress_sender = progress.clone();
        let cancel_flag_reader = cancel_flag.clone();
        let read_handle = tokio::task::spawn_blocking(move || {
            parse_avrdude_output(stderr, &cancel_flag_reader, &progress_sender)
        });

        // Wait for the process, checking cancel_flag periodically
        let start = Instant::now();
        loop {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::FlashCancelled);
            }

            match child.try_wait() {
                Ok(Some(status)) => {
                    let read_result = tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        read_handle,
                    )
                    .await
                    .map_err(|_| {
                        AppError::Generic("Timed out waiting for avrdude output reader".into())
                    })?
                    .map_err(|e| {
                        AppError::Generic(format!("avrdude reader task panicked: {}", e))
                    })?;

                    let avr_messages = read_result;

                    if status.success() {
                        let _ = progress.send(FlashProgress {
                            stage: FlashStage::Complete,
                            percent: 100,
                            message: format!(
                                "avrdude completed in {:.1}s",
                                start.elapsed().as_secs_f64()
                            ),
                        })
                        .await;
                        return Ok(());
                    }

                    let error_text = avr_messages
                        .iter()
                        .filter(|(_ty, msg)| msg.contains("error") || msg.contains("Error") || msg.contains("fail"))
                        .map(|(_, msg)| msg.clone())
                        .collect::<Vec<_>>()
                        .join("\n");

                    let last_lines = avr_messages
                        .iter()
                        .rev()
                        .take(5)
                        .map(|(_, msg)| msg.clone())
                        .collect::<Vec<_>>()
                        .join("\n");

                    return Err(AppError::FlashError(format!(
                        "avrdude failed with exit code {:?}.\nMessages:\n{}",
                        status.code(),
                        if error_text.is_empty() {
                            last_lines
                        } else {
                            error_text
                        }
                    )));
                }
                Ok(None) => {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(e) => {
                    return Err(AppError::Generic(format!(
                        "Cannot wait for avrdude: {}",
                        e
                    )));
                }
            }
        }
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
    }
}

fn extension_for(format: &FirmwareFormat) -> &str {
    match format {
        FirmwareFormat::Hex => ".hex",
        FirmwareFormat::Bin => ".bin",
        _ => ".hex",
    }
}

type AvrMessage = (String, String);

fn parse_avrdude_output(
    stderr: std::process::ChildStderr,
    cancel_flag: &Arc<AtomicBool>,
    progress: &mpsc::Sender<FlashProgress>,
) -> Vec<AvrMessage> {
    let reader = BufReader::new(stderr);
    let mut messages: Vec<AvrMessage> = Vec::new();

    for line in reader.lines() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let (msg_type, _msg_text) = classify_avrdude_line(trimmed);
        messages.push((msg_type.clone(), trimmed.to_string()));

        // Parse progress from writing/reading lines
        if let Some(pct) = parse_avrdude_percent(trimmed) {
            let stage = if trimmed.contains("Reading") {
                FlashStage::Verifying
            } else {
                FlashStage::Writing
            };
            let _ = progress.try_send(FlashProgress {
                stage,
                percent: pct,
                message: trimmed.to_string(),
            });
        } else {
            let stage = match msg_type.as_str() {
                "info" => FlashStage::EnteringBootloader,
                "error" => FlashStage::Error,
                _ => FlashStage::Writing,
            };
            // Don't spam every line; just the ones with progress or significant content
            if msg_type != "debug" {
                let _ = progress.try_send(FlashProgress {
                    stage,
                    percent: u8::MAX,
                    message: trimmed.to_string(),
                });
            }
        }
    }

    messages
}

fn classify_avrdude_line(line: &str) -> (String, String) {
    let lower = line.to_lowercase();
    if lower.contains("error") || lower.contains("fail") || lower.contains("cannot") {
        ("error".into(), line.into())
    } else if lower.contains("warning") {
        ("warning".into(), line.into())
    } else if lower.contains("reading") || lower.contains("writing") || lower.contains("verif") {
        ("progress".into(), line.into())
    } else if lower.contains("avrdude") && (lower.contains("done") || lower.contains("thank")) {
        ("done".into(), line.into())
    } else {
        ("info".into(), line.into())
    }
}

fn parse_avrdude_percent(line: &str) -> Option<u8> {
    // avrdude 7.x output: "Writing | #####... | 75% 1.23s"
    // avrdude 8.x output: similar with progress bars
    let pct_marker = line.find('%')?;
    let before_pct = &line[..pct_marker];
    let pct_start = before_pct.rfind(|c: char| !c.is_ascii_digit())?;
    let pct_str = &before_pct[pct_start + 1..];
    pct_str.parse::<u8>().ok()
}
