//! Runs an external tool, streams its output line by line, and kills it on cancel.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Stdout,
    Stderr,
}

/// A command with the console window hidden on Windows.
pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Resolve on PATH explicitly so probing and flashing can use the same executable.
pub fn path_candidates(name: &str) -> impl Iterator<Item = PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let name = if cfg!(windows) { format!("{name}.exe") } else { name.into() };
    std::env::split_paths(&path)
        .filter(|directory| directory.is_absolute())
        .map(move |directory| directory.join(&name))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>()
        .into_iter()
}

fn pump<R: Read + Send + 'static>(reader: R, stream: Stream, tx: mpsc::Sender<(Stream, String)>) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf);
                    let line = line.trim_end_matches(['\r', '\n']);
                    if tx.send((stream, line.to_string())).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Runs `cmd` to completion on the calling thread, calling `on_line` for every
/// output line. Returns `FlashCancelled` if `cancel` is set while it runs.
/// Call from a blocking context (`spawn_blocking`).
pub fn run_streaming(
    mut cmd: Command,
    tool: &str,
    cancel: Option<Arc<AtomicBool>>,
    mut on_line: impl FnMut(Stream, &str),
) -> AppResult<ExitStatus> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::ToolNotFound {
                tool: tool.to_string(),
                install_cmd: "see the Modules page".into(),
            }
        } else {
            AppError::Generic(format!("Cannot start {}: {}", tool, e))
        }
    })?;

    let (tx, rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        pump(out, Stream::Stdout, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, Stream::Stderr, tx.clone());
    }
    drop(tx);

    let mut status = None;
    loop {
        if cancel.as_ref().is_some_and(|c| c.load(Ordering::Relaxed)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::FlashCancelled);
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok((stream, line)) => on_line(stream, &line),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if status.is_none() {
                    status = child.try_wait().map_err(|e| AppError::Generic(format!("Cannot wait for {}: {}", tool, e)))?;
                }
            }
            // Both pipes closed: the output is complete.
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    match status {
        Some(s) => Ok(s),
        None => child.wait().map_err(|e| AppError::Generic(format!("Cannot wait for {}: {}", tool, e))),
    }
}

/// Probe a tool without allowing a broken executable to stall the environment check.
pub fn capture(mut cmd: Command) -> Option<(ExitStatus, String)> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
    let (tx, rx) = mpsc::channel();
    pump(child.stdout.take().expect("stdout is piped"), Stream::Stdout, tx.clone());
    pump(child.stderr.take().expect("stderr is piped"), Stream::Stderr, tx);

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut text = String::new();
    let mut output_closed = false;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        if output_closed {
            if let Ok(Some(status)) = child.try_wait() {
                return Some((status, text.trim().into()));
            }
            std::thread::sleep(remaining.min(Duration::from_millis(20)));
            continue;
        }
        match rx.recv_timeout(remaining) {
            Ok((_, line)) if text.len() + line.len() < 1024 * 1024 => {
                text.push_str(&line);
                text.push('\n');
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => output_closed = true,
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}
