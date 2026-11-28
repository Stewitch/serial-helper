//! STC89/STC90 flashing through stcgal, driven by `stc89_flash.py`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::module_trait::ModuleChip;
use super::orchestrator::ToolSource;
use crate::error::{AppError, AppResult};
use crate::firmware::FirmwareData;
use crate::tools::managed::ManagedTool;
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

#[derive(Debug, Clone)]
pub struct Python {
    executable: PathBuf,
}

impl Python {
    pub fn command(&self) -> Command {
        let mut cmd = hidden_command(&self.executable);
        cmd.args(["-I", "-X", "utf8"]);
        cmd
    }

    pub fn display(&self) -> String {
        self.executable.display().to_string()
    }
}

fn system_pythons() -> impl Iterator<Item = Python> {
    ["python", "py", "python3"].into_iter().flat_map(|name| {
        runner::path_candidates(name).filter_map(move |candidate| {
            // A Store placeholder can open the Store while checking a clean machine.
            #[cfg(windows)]
            if candidate.parent().and_then(Path::file_name).is_some_and(|dir| dir.eq_ignore_ascii_case("WindowsApps")) {
                return None;
            }
            let mut cmd = hidden_command(&candidate);
            if name == "py" {
                cmd.arg("-3");
            }
            cmd.args(["-I", "-X", "utf8", "-c", "import sys; print(sys.executable) if sys.version_info.major == 3 else sys.exit(1)"]);
            let (status, output) = runner::capture(cmd)?;
            let executable = PathBuf::from(output.lines().find(|line| Path::new(line).is_absolute())?);
            (status.success() && executable.is_file()).then_some(Python { executable })
        })
    })
}

fn script_file() -> AppResult<tempfile::NamedTempFile> {
    let mut file = tempfile::Builder::new().prefix("serial-helper-stc89-").suffix(".py").tempfile()
        .map_err(|e| AppError::Generic(format!("Cannot create STC89 script: {e}")))?;
    file.write_all(SCRIPT.as_bytes())
        .map_err(|e| AppError::Generic(format!("Cannot write STC89 script: {e}")))?;
    Ok(file)
}

pub enum ToolCheck {
    NoPython,
    NoStcgal { detail: String },
    Ready { python: Python, version: String, source: ToolSource },
}

fn probe(python: &Python) -> AppResult<String> {
    let script = script_file()?;
    let mut cmd = python.command();
    cmd.arg(script.path()).args(["--port", "-", "--check"]);
    match runner::capture(cmd) {
        Some((status, out)) if status.success() => Ok(out),
        Some((_, out)) => Err(AppError::Generic(strip_events(&out))),
        None => Err(AppError::Generic("Python could not be started or did not respond".into())),
    }
}

fn managed_python(runtime: &Path) -> Python {
    Python { executable: runtime.join("python.exe") }
}

pub fn validate_runtime(runtime: &Path) -> AppResult<()> {
    probe(&managed_python(runtime)).map(|_| ())
}

pub fn check_tools(tools_dir: &Path) -> ToolCheck {
    let managed = ManagedTool::Stc89.path(tools_dir);
    let mut first_error = None;
    let local = managed.is_dir().then(|| (managed_python(&managed), ToolSource::Managed));
    for (python, source) in local.into_iter().chain(system_pythons().map(|python| (python, ToolSource::System))) {
        match probe(&python) {
            Ok(version) => return ToolCheck::Ready { python, version, source },
            Err(error) => {
                first_error.get_or_insert_with(|| format!("{}: {error}", python.display()));
            }
        }
    }
    match first_error {
        Some(detail) => ToolCheck::NoStcgal { detail },
        None => ToolCheck::NoPython,
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
    python: &Python,
    port: &str,
    image: &[u8],
    options: &Stc89Options,
    cancel: Arc<AtomicBool>,
    mut on_event: impl FnMut(&ScriptEvent),
    mut on_log: impl FnMut(Stream, &str),
) -> AppResult<()> {
    options.validate()?;
    let script = script_file()?;

    let tmp = tempfile::Builder::new()
        .prefix("serial-helper-stc89-")
        .suffix(".bin")
        .tempfile()
        .map_err(|e| AppError::Generic(format!("Cannot create temp file: {}", e)))?;
    std::fs::write(tmp.path(), image).map_err(|e| AppError::Generic(format!("Cannot write temp firmware: {}", e)))?;

    let mut cmd = python.command();
    cmd.arg(script.path())
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
