use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::{avr_cmd, flash_cmd};
use crate::error::AppError;
use crate::firmware::{bin, hex};
use crate::flash::module_trait::{ModuleAvailability, ModuleDescriptor};
use crate::flash::orchestrator::EnvStatus;
use crate::flash::registry;
use crate::flash::stc89::{self, Stc89Options};
use crate::state::AppState;
use crate::tools::runner::Stream;

#[derive(Debug, Clone, Serialize)]
pub struct ModuleEnvUpdate {
    pub module: ModuleDescriptor,
    pub env: EnvStatus,
}

#[tauri::command]
pub fn list_modules() -> Vec<ModuleDescriptor> {
    registry::modules().iter().map(|m| m.descriptor()).collect()
}

#[tauri::command]
pub async fn check_module_env(module_id: String) -> Result<EnvStatus, AppError> {
    let module = registry::find(&module_id).ok_or_else(|| AppError::Generic(format!("Unknown module '{}'", module_id)))?;
    tokio::task::spawn_blocking(move || module.check_environment())
        .await
        .map_err(|e| AppError::Generic(format!("Environment check panicked: {}", e)))
}

/// Checks every module in the background and emits `module-env-update` for each.
#[tauri::command]
pub fn start_module_scan(app: AppHandle) {
    std::thread::spawn(move || {
        for module in registry::modules() {
            let env = module.check_environment();
            let _ = app.emit("module-env-update", ModuleEnvUpdate { module: module.descriptor(), env });
        }
        let _ = app.emit("module-scan-done", ());
    });
}

#[derive(Clone, Serialize)]
struct InstallLine {
    module: String,
    line: String,
}

/// Installs a module's missing tools where the app can do it itself (pip packages).
#[tauri::command]
pub async fn install_module_tools(app: AppHandle, module_id: String) -> Result<EnvStatus, AppError> {
    if module_id != registry::STC89 {
        return Err(AppError::Generic(format!("Module '{}' cannot install its tools automatically", module_id)));
    }
    let app2 = app.clone();
    let id = module_id.clone();
    tokio::task::spawn_blocking(move || {
        stc89::install_stcgal(|line| {
            let _ = app2.emit("module-install-output", InstallLine { module: id.clone(), line: line.to_string() });
        })
    })
    .await
    .map_err(|e| AppError::Generic(format!("Install task panicked: {}", e)))??;
    check_module_env(module_id).await
}

/* ---------------- Flashing ---------------- */

#[derive(Clone, Serialize)]
struct ProgressEvent {
    stage: String,
    percent: u8,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    address: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    length: Option<u32>,
}

fn emit(app: &AppHandle, stage: &str, percent: u8, message: &str) {
    let _ = app.emit(
        "flash-progress",
        ProgressEvent { stage: stage.into(), percent, message: message.into(), address: None, length: None },
    );
}

/// Module-specific options, tagged by module id.
#[derive(Deserialize)]
#[serde(tag = "module", rename_all = "kebab-case")]
pub enum ModuleFlashOptions {
    #[serde(rename = "stm32-isp", rename_all = "camelCase")]
    Stm32 { baud_rate: u32, options: flash_cmd::FlashOptions },
    #[serde(rename = "arduino-avr")]
    Avr { options: avr_cmd::AvrFlashOptions },
    #[serde(rename = "stc89-stcgal")]
    Stc89 { options: Stc89Options },
}

/// One entry point for every module. Progress goes out as `flash-progress` events;
/// `cancel_flash` stops any of them.
#[tauri::command]
pub async fn module_flash(
    app: AppHandle,
    state: State<'_, AppState>,
    firmware_path: String,
    port_name: String,
    request: ModuleFlashOptions,
) -> Result<(), AppError> {
    match request {
        ModuleFlashOptions::Stm32 { baud_rate, options } => {
            flash_cmd::start_flash(app, state, firmware_path, port_name, baud_rate, options).await
        }
        ModuleFlashOptions::Avr { options } => avr_cmd::flash_avr_start(app, state, firmware_path, port_name, options).await,
        ModuleFlashOptions::Stc89 { options } => flash_stc89(app, state, firmware_path, port_name, options).await,
    }
}

async fn flash_stc89(
    app: AppHandle,
    state: State<'_, AppState>,
    firmware_path: String,
    port_name: String,
    options: Stc89Options,
) -> Result<(), AppError> {
    let start = Instant::now();
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel = state.cancel_flag.clone();

    let module = registry::find(registry::STC89).expect("stc89 module registered");
    if module.descriptor().availability != ModuleAvailability::Available {
        return Err(AppError::Generic("STC89 module is not available".into()));
    }
    let chip = stc89::chips()
        .into_iter()
        .find(|c| c.id == options.chip)
        .ok_or_else(|| AppError::UnsupportedChip(options.chip.clone()))?;

    emit(&app, "parsing", 0, "Parsing firmware...");
    let path = Path::new(&firmware_path);
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("firmware").to_string();
    let data = std::fs::read(path).map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let firmware = match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(&filename, &data)?,
        "bin" => bin::parse_bin(&filename, &data, 0)?,
        _ => return Err(AppError::FirmwareParseError(format!("STC89 flashing supports .hex and .bin, not .{}", ext))),
    };
    let image = stc89::flat_image(&firmware, chip.flash_kb as usize * 1024)?;
    emit(&app, "parsing", 2, &format!("Firmware: {} bytes for {}", image.len(), chip.name));

    // The port must be free: the wrapper opens it itself.
    {
        let mgr = state.serial_manager.read();
        if mgr.is_open() {
            mgr.close()?;
        }
    }

    let app_ev = app.clone();
    let app_log = app.clone();
    let port = port_name.clone();
    let result = tokio::task::spawn_blocking(move || {
        stc89::flash(
            &port,
            &image,
            &options,
            cancel,
            |ev| {
                if ev.stage == "error" || ev.stage == "complete" {
                    return; // reported through the command result
                }
                let _ = app_ev.emit(
                    "flash-progress",
                    ProgressEvent {
                        stage: ev.stage.clone(),
                        percent: ev.percent.unwrap_or(0),
                        message: ev.message.clone(),
                        address: ev.address,
                        length: ev.length,
                    },
                );
            },
            |stream, line| {
                let stage = if stream == Stream::Stderr { "log-warn" } else { "log" };
                emit(&app_log, stage, 0, line);
            },
        )
    })
    .await
    .map_err(|e| AppError::Generic(format!("Flash task panicked: {}", e)))?;

    result?;
    emit(&app, "complete", 100, &format!("Done in {:.1}s", start.elapsed().as_secs_f64()));
    Ok(())
}
