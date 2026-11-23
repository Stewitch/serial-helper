//! STC89/STC90 flashing through stcgal, driven by `stc89_flash.py`.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::module_trait::ModuleChip;
use crate::error::{AppError, AppResult};
use crate::firmware::FirmwareData;
use crate::tools::runner::{self, hidden_command, Stream};

const SCRIPT: &str = include_str!("stc89_flash.py");

/// STC89/90 parts the module offers. Sizes follow stcgal's models.py (code area only).
pub fn chips() -> Vec<ModuleChip> {
    // (id, name, code bytes, RAM KB)
    let parts: [(&str, &str, u32, f32); 9] = [
        ("STC89C51RC", "STC89C51RC", 4096, 0.5),
        ("STC89C52RC", "STC89C52RC", 8192, 0.5),
        ("STC89C53RC", "STC89C53RC", 14336, 0.5),
        ("STC89C54RD+", "STC89C54RD+", 16384, 1.25),
        ("STC89C58RD+", "STC89C58RD+", 32768, 1.25),
        ("STC89C516RD+", "STC89C516RD+", 63488, 1.25),
        ("STC89C52", "STC89C52 (7.x BSL)", 8192, 0.5),
        ("STC90C52RC", "STC90C52RC", 8192, 0.5),
        ("STC90C54RD+", "STC90C54RD+", 16384, 1.25),
    ];
    parts
        .iter()
        .map(|&(id, name, code, ram)| ModuleChip {
            id: id.into(),
            name: name.into(),
            flash_kb: code.div_ceil(1024),
            ram_kb: ram,
            flash_start: 0,
            // The bootloader erases in 512-byte blocks and writes 128-byte blocks.
            page_size: 512,
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stc89Options {
    pub chip: String,
    /// "dtr" or "rts": the line that switches the board's power.
    #[serde(default = "default_pin")]
    pub power_pin: String,
    /// Physical pin level that turns the board off: "low" or "high".
    #[serde(default = "default_off_level")]
    pub off_level: String,
    #[serde(default = "default_off_ms")]
    pub off_ms: u32,
    /// "auto", "stc89" or "stc89a".
    #[serde(default = "default_protocol")]
    pub protocol: String,
    #[serde(default = "default_baud")]
    pub transfer_baud: u32,
}

fn default_pin() -> String {
    "dtr".into()
}
fn default_off_level() -> String {
    "low".into()
}
fn default_off_ms() -> u32 {
    500
}
fn default_protocol() -> String {
    "auto".into()
}
fn default_baud() -> u32 {
    115200
}

impl Stc89Options {
    fn validate(&self) -> AppResult<()> {
        let bad = |what: &str| Err(AppError::Generic(format!("Invalid STC89 option: {}", what)));
        if !matches!(self.power_pin.as_str(), "dtr" | "rts") {
            return bad("power pin");
        }
        if !matches!(self.off_level.as_str(), "low" | "high") {
            return bad("off level");
        }
        if !matches!(self.protocol.as_str(), "auto" | "stc89" | "stc89a") {
            return bad("protocol");
        }
        if !(50..=5000).contains(&self.off_ms) {
            return bad("power-off time must be 50 to 5000 ms");
        }
        if !(1200..=1_000_000).contains(&self.transfer_baud) {
            return bad("transfer baud rate");
        }
        Ok(())
    }
}

/* ---------------- Python discovery ---------------- */

/// A way to start Python 3: program plus leading arguments.
#[derive(Debug, Clone)]
pub struct Python {
    pub program: String,
    pub args: Vec<String>,
}

impl Python {
    pub fn command(&self) -> Command {
        let mut cmd = hidden_command(&self.program);
        cmd.args(&self.args);
        // Isolated mode: ignore PYTHON* variables, the user site's cwd and script dir imports.
        cmd.arg("-I");
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd
    }

    pub fn display(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Finds a working Python 3. The Microsoft Store `python.exe` alias fails this check.
pub fn find_python() -> Option<Python> {
    let candidates: [(&str, &[&str]); 3] = [("python", &[]), ("py", &["-3"]), ("python3", &[])];
    candidates.iter().find_map(|(program, args)| {
        let py = Python {
            program: (*program).into(),
            args: args.iter().map(|s| (*s).into()).collect(),
        };
        let mut cmd = py.command();
        cmd.args(["-c", "import sys; print(sys.version_info[0])"]);
        match runner::capture(cmd) {
            Some((status, out)) if status.success() && out.trim() == "3" => Some(py),
            _ => None,
        }
    })
}

/// Writes the wrapper script to a private temp folder and returns its path.
fn script_path() -> AppResult<PathBuf> {
    let dir = std::env::temp_dir().join("serialhelper-stc89");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Generic(format!("Cannot create {}: {}", dir.display(), e)))?;
    let path = dir.join("stc89_flash.py");
    let current = std::fs::read_to_string(&path).ok();
    if current.as_deref() != Some(SCRIPT) {
        std::fs::write(&path, SCRIPT).map_err(|e| AppError::Generic(format!("Cannot write {}: {}", path.display(), e)))?;
    }
    Ok(path)
}

pub enum ToolCheck {
    NoPython,
    NoStcgal { python: Python, detail: String },
    Ready { python: Python, version: String },
}

pub fn check_tools() -> ToolCheck {
    let Some(python) = find_python() else {
        return ToolCheck::NoPython;
    };
    let script = match script_path() {
        Ok(p) => p,
        Err(e) => return ToolCheck::NoStcgal { python, detail: e.to_string() },
    };
    let mut cmd = python.command();
    cmd.arg(&script).args(["--port", "-", "--check"]);
    match runner::capture(cmd) {
        Some((status, out)) if status.success() => ToolCheck::Ready { python, version: out },
        Some((_, out)) => ToolCheck::NoStcgal { python, detail: strip_events(&out) },
        None => ToolCheck::NoStcgal { python, detail: "Python could not be started".into() },
    }
}

fn strip_events(text: &str) -> String {
    text.lines()
        .map(|l| match l.strip_prefix("@@").and_then(|j| serde_json::from_str::<ScriptEvent>(j).ok()) {
            Some(ev) => ev.message,
            None => l.to_string(),
        })
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Runs `python -m pip install --upgrade stcgal`, streaming its output.
pub fn install_stcgal(on_line: impl FnMut(&str)) -> AppResult<()> {
    let python = find_python().ok_or_else(|| AppError::ToolNotFound {
        tool: "Python 3".into(),
        install_cmd: "https://www.python.org/downloads/windows/".into(),
    })?;
    let mut on_line = on_line;
    let mut cmd = python.command();
    cmd.args(["-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "stcgal"]);
    let status = runner::run_streaming(cmd, "pip", None, |_, line| on_line(line))?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Generic(format!("pip exited with code {:?}", status.code())))
    }
}

/* ---------------- Flashing ---------------- */

#[derive(Debug, Deserialize)]
pub struct ScriptEvent {
    pub stage: String,
    #[serde(default)]
    pub message: String,
    pub percent: Option<u8>,
    pub address: Option<u32>,
    pub length: Option<u32>,
}

/// Lays the firmware out as one image starting at address 0, gaps filled with 0xFF.
pub fn flat_image(firmware: &FirmwareData, max_size: usize) -> AppResult<Vec<u8>> {
    let end = firmware
        .segments
        .iter()
        .map(|s| s.address as usize + s.data.len())
        .max()
        .unwrap_or(0);
    if end == 0 {
        return Err(AppError::FirmwareParseError("No data in firmware".into()));
    }
    if end > max_size {
        return Err(AppError::FlashError(format!(
            "Firmware ends at 0x{:X}, but the chip has {} bytes of flash",
            end, max_size
        )));
    }
    let mut image = vec![0xFF; end];
    for seg in &firmware.segments {
        let at = seg.address as usize;
        image[at..at + seg.data.len()].copy_from_slice(&seg.data);
    }
    Ok(image)
}

/// Runs the wrapper and calls `on_event` for each progress event and `on_log` for other output.
/// Blocking; call from `spawn_blocking`.
pub fn flash(
    port: &str,
    image: &[u8],
    options: &Stc89Options,
    cancel: Arc<AtomicBool>,
    mut on_event: impl FnMut(&ScriptEvent),
    mut on_log: impl FnMut(Stream, &str),
) -> AppResult<()> {
    options.validate()?;
    let python = find_python().ok_or_else(|| AppError::ToolNotFound {
        tool: "Python 3".into(),
        install_cmd: "see the Modules page".into(),
    })?;
    let script = script_path()?;

    let tmp = tempfile::Builder::new()
        .prefix("serialhelper-stc89-")
        .suffix(".bin")
        .tempfile()
        .map_err(|e| AppError::Generic(format!("Cannot create temp file: {}", e)))?;
    std::fs::write(tmp.path(), image).map_err(|e| AppError::Generic(format!("Cannot write temp firmware: {}", e)))?;

    let mut cmd = python.command();
    cmd.arg(&script)
        .arg("--port")
        .arg(port)
        .arg("--image")
        .arg(tmp.path())
        .args(["--protocol", &options.protocol])
        .args(["--pin", &options.power_pin])
        .args(["--off-level", &options.off_level])
        .args(["--off-ms", &options.off_ms.to_string()])
        .args(["--baud", &options.transfer_baud.to_string()]);

    let mut last_error: Option<String> = None;
    let mut log_tail: Vec<String> = Vec::new();
    let status = runner::run_streaming(cmd, "python", Some(cancel), |stream, line| {
        if let Some(ev) = line.strip_prefix("@@").and_then(|j| serde_json::from_str::<ScriptEvent>(j).ok()) {
            if ev.stage == "error" {
                last_error = Some(ev.message.clone());
            }
            on_event(&ev);
        } else if !line.trim().is_empty() {
            log_tail.push(line.to_string());
            if log_tail.len() > 8 {
                log_tail.remove(0);
            }
            on_log(stream, line);
        }
    })?;
    drop(tmp);

    if status.success() {
        return Ok(());
    }
    Err(AppError::FlashError(last_error.unwrap_or_else(|| {
        format!("stcgal exited with code {:?}\n{}", status.code(), log_tail.join("\n"))
    })))
}
