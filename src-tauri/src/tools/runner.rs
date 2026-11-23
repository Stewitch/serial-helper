//! Runs an external tool, streams its output line by line, and kills it on cancel.

use std::io::{BufRead, BufReader, Read};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Stdout,
    Stderr,
}

/// A command with the console window hidden on Windows.
pub fn hidden_command(program: &str) -> Command {
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

/// Runs a short command and returns its combined output, or None if it could not start.
pub fn capture(mut cmd: Command) -> Option<(ExitStatus, String)> {
    cmd.stdin(Stdio::null());
    let out = cmd.output().ok()?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&err);
    }
    Some((out.status, text.trim().to_string()))
}
