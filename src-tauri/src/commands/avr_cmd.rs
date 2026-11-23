use std::fs;
use std::path::Path;
use std::time::Instant;

use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::flash::arduino_avr::{AvrdudeConfig, AvrdudeFlasher};
use crate::flash::avr_chips;
use crate::flash::orchestrator::{FlashProgress, FirmwareFormat};
use crate::firmware::{self, hex, bin};
use crate::state::AppState;

#[derive(Clone, Serialize)]
struct FlashProgressEvent {
    stage: String,
    percent: u8,
    message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvrFlashOptions {
    pub programmer: String,
    pub chip: String,
    pub verify: bool,
    pub run_after: bool,
}

fn emit_progress(app: &AppHandle, stage: &str, percent: u8, message: &str) {
    let _ = app.emit("flash-progress", FlashProgressEvent {
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    });
}

/// Parse firmware for AVR (supports .hex only for typical Arduino usage, .bin with base addr)
fn parse_avr_firmware(path: &str, base_address: Option<u32>) -> AppResult<firmware::FirmwareData> {
    let file_path = Path::new(path);
    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("firmware");
    let data = fs::read(path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(filename, &data),
        "bin" => bin::parse_bin(filename, &data, base_address.unwrap_or(0)),
        _ => Err(AppError::FirmwareParseError(format!(
            "AVR flashing supports .hex and .bin files. Unsupported: .{}",
            ext
        ))),
    }
}

pub async fn flash_avr_start(
    app: AppHandle,
    state: State<'_, AppState>,
    firmware_path: String,
    port_name: String,
    options: AvrFlashOptions,
) -> Result<(), AppError> {
    let start = Instant::now();

    state.cancel_flag.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.cancel_flag.clone();

    // 1. Parse firmware
    emit_progress(&app, "parsing", 0, "Parsing firmware...");
    let firmware = parse_avr_firmware(&firmware_path, None)?;

    if firmware.segments.is_empty() {
        return Err(AppError::FirmwareParseError("No data in firmware".into()));
    }

    let total_size: usize = firmware.segments.iter().map(|s| s.data.len()).sum();
    emit_progress(&app, "parsing", 5, &format!(
        "Firmware: {} bytes, {} segment(s)", total_size, firmware.segments.len()
    ));

    // Flatten segments into a single buffer (avrdude writes one file)
    // AVR firmware is typically contiguous from address 0
    let flat_data: Vec<u8> = firmware
        .segments
        .iter()
        .flat_map(|s| s.data.clone())
        .collect();

    // 2. Look up chip in database
    let chip = avr_chips::find_avr_chip_by_name(&options.chip)
        .ok_or_else(|| AppError::UnsupportedChip(format!(
            "Unknown AVR chip '{}'. Check the chip name matches an avrdude part name.",
            options.chip
        )))?;

    emit_progress(&app, "detecting", 10, &format!(
        "Target: {} (avrdude -p {})", chip.name, chip.avrdude_part
    ));

    if total_size > chip.flash_kb as usize * 1024 {
        return Err(AppError::FlashError(format!(
            "Firmware ({} bytes) exceeds chip flash size ({} KB)",
            total_size, chip.flash_kb
        )));
    }

    // 3. Close serial port if open (avrdude needs exclusive access)
    {
        let mgr = state.serial_manager.read();
        if mgr.is_open() {
            emit_progress(&app, "connecting", 12, "Closing serial port for avrdude...");
            drop(mgr);
            let mgr = state.serial_manager.read();
            mgr.close()?;
        }
    }

    // 4. Build avrdude config
    let avr_config = AvrdudeConfig {
        programmer: options.programmer.clone(),
        part: chip.avrdude_part.clone(),
        port: port_name.clone(),
        baud_rate: 115200,
    };

    emit_progress(&app, "connecting", 15, &format!(
        "avrdude -c {} -p {} -P {}",
        avr_config.programmer, avr_config.part, avr_config.port
    ));

    // 5. Run avrdude
    let flasher = AvrdudeFlasher::new(cancel_flag.clone());
    let format = match firmware.source_format {
        firmware::FirmwareFormat::Hex => FirmwareFormat::Hex,
        firmware::FirmwareFormat::Bin => FirmwareFormat::Bin,
        _ => FirmwareFormat::Hex,
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel::<FlashProgress>(32);

    let app_clone = app.clone();
    let forward_handle = tokio::spawn(async move {
        while let Some(p) = rx.recv().await {
            let _ = app_clone.emit("flash-progress", FlashProgressEvent {
                stage: format!("{:?}", p.stage).to_lowercase(),
                percent: if p.percent == u8::MAX { 0 } else { p.percent },
                message: p.message,
            });
        }
    });

    let result = flasher.flash(&avr_config, &flat_data, &format, tx).await;

    // tx is dropped when flasher completes; wait for rx to finish
    let _ = forward_handle.await;

    match result {
        Ok(()) => {
            let elapsed = start.elapsed();
            emit_progress(&app, "complete", 100, &format!(
                "Done: {} bytes in {:.1}s", total_size, elapsed.as_secs_f64()
            ));
            Ok(())
        }
        Err(e) => Err(e),
    }
}
