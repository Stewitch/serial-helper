use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::{avr_cmd, flash_cmd};
use crate::error::AppError;
use crate::firmware::{bin, hex};
use crate::flash::module_trait::ModuleDescriptor;
use crate::flash::orchestrator::EnvStatus;
use crate::flash::registry;
use crate::flash::stc89::{self, Stc89Options};
use crate::state::AppState;
use crate::tools::managed::{self, ManagedTool};
use crate::tools::runner::Stream;

#[tauri::command]
pub fn list_modules() -> Vec<ModuleDescriptor> {
    registry::modules().iter().map(|m| m.descriptor()).collect()
}

#[tauri::command]
pub async fn check_module_env(app: AppHandle, module_id: String) -> Result<EnvStatus, AppError> {
    let module = registry::find(&module_id).ok_or_else(|| AppError::Generic(format!("Unknown module '{}'", module_id)))?;
    let tools_dir = managed::tools_dir(&app)?;
    tokio::task::spawn_blocking(move || module.check_environment(&tools_dir))
        .await
        .map_err(|e| AppError::Generic(format!("Environment check panicked: {}", e)))
}

#[derive(Clone, Serialize)]
struct InstallLine {
    module: String,
    line: String,
}

#[tauri::command]
pub async fn install_module_tools(app: AppHandle, module_id: String) -> Result<EnvStatus, AppError> {
    let module = registry::find(&module_id).ok_or_else(|| AppError::Generic(format!("Unknown module '{module_id}'")))?;
    let tool = module.managed_tool().ok_or_else(|| AppError::Generic(format!("Module '{module_id}' has no installable tools")))?;
    let tools_dir = managed::tools_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let env = module.check_environment(&tools_dir);
        if env.ready {
            return Ok(env);
        }
        let validate = match tool {
            ManagedTool::Avrdude => crate::flash::arduino_avr::validate_runtime,
            ManagedTool::Stc89 => stc89::validate_runtime,
        };
        tool.install(&tools_dir, validate, |line| {
            let _ = app.emit("module-install-output", InstallLine { module: module_id.clone(), line: line.to_string() });
        })?;
        let env = module.check_environment(&tools_dir);
        if !env.ready {
            return Err(AppError::Generic(env.messages.join("\n")));
        }
        Ok(env)
    })
    .await
    .map_err(|e| AppError::Generic(format!("Install task panicked: {}", e)))?
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

    let tools_dir = managed::tools_dir(&app)?;
    let python = match tokio::task::spawn_blocking(move || stc89::check_tools(&tools_dir))
        .await
        .map_err(|e| AppError::Generic(format!("STC89 environment check failed: {e}")))?
    {
        stc89::ToolCheck::Ready { python, .. } => python,
        stc89::ToolCheck::NoStcgal { detail } => return Err(AppError::Generic(detail)),
        stc89::ToolCheck::NoPython => return Err(AppError::ToolNotFound {
            tool: "Python 3 and stcgal".into(),
            install_cmd: "see the Modules page".into(),
        }),
    };
    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::FlashCancelled);
    }

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
            &python,
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
