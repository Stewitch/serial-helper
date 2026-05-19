use std::fs;
use std::path::Path;
use std::time::Instant;

use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use serde::{Serialize, Deserialize};
use sha2::{Sha256, Digest};

use crate::error::AppError;
use crate::firmware::{FirmwareInfo, SegmentInfo, bin, hex};
use crate::flash::chips::{self, Stm32ChipInfo};
use crate::flash::stm32_isp::Stm32Isp;
use crate::state::{AppState, FirmwareCacheEntry};

#[derive(Clone, Serialize)]
struct FlashProgressEvent {
    stage: String,
    percent: u8,
    message: String,
}

#[derive(Clone, Serialize)]
pub struct ChipInfoResult {
    pub device_id: u16,
    pub device_id_hex: String,
    pub pid: Option<u16>,
    pub bootloader_version: u8,
    pub chip_match: Option<Stm32ChipInfo>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DtrRtsConfig {
    pub rts_function: String,       // "none" | "reset" | "bootloader"
    pub rts_active_level: String,   // "low" | "high"
    pub dtr_function: String,
    pub dtr_active_level: String,
}

impl Default for DtrRtsConfig {
    fn default() -> Self {
        Self {
            rts_function: "reset".into(),
            rts_active_level: "low".into(),
            dtr_function: "bootloader".into(),
            dtr_active_level: "high".into(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashOptions {
    pub verify: bool,
    pub run_after: bool,
    pub auto_reset: bool,
    #[serde(default)]
    pub dtr_rts: DtrRtsConfig,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectOptions {
    pub auto_reset: bool,
    #[serde(default)]
    pub dtr_rts: DtrRtsConfig,
}

fn emit_progress(app: &AppHandle, stage: &str, percent: u8, message: &str) {
    let _ = app.emit("flash-progress", FlashProgressEvent {
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    });
}

fn parse_supported_firmware_from_path(
    firmware_path: &str,
    data: &[u8],
) -> Result<crate::firmware::FirmwareData, AppError> {
    let path = Path::new(firmware_path);
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("firmware");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(filename, data),
        "bin" => bin::parse_bin(filename, data, 0x0800_0000),
        "" => Err(AppError::FirmwareParseError(
            "Firmware file must have a supported extension (.hex, .ihx, .bin)".into(),
        )),
        _ => Err(AppError::FirmwareParseError(format!(
            "Unsupported firmware format '.{}'. Only .hex/.ihx/.bin are currently flashable.",
            ext
        ))),
    }
}

fn file_signature(path: &str) -> Result<(u64, u128), AppError> {
    let metadata = fs::metadata(path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
    let modified = metadata
        .modified()
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file metadata: {}", e)))?;
    let modified_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| AppError::FirmwareParseError(format!("Invalid file modified time: {}", e)))?
        .as_millis();
    Ok((metadata.len(), modified_ms))
}

// ─── DTR/RTS Bootloader Entry ───
fn dtr_rts_enter_bootloader(isp: &mut Stm32Isp, cfg: &DtrRtsConfig) -> Result<(), AppError> {
    use std::thread::sleep;
    use std::time::Duration;

    let set_pin = |isp: &mut Stm32Isp, pin: &str, level: bool| -> Result<(), AppError> {
        match pin {
            "rts" => isp.set_rts(level),
            "dtr" => isp.set_dtr(level),
            _ => Ok(()),
        }
    };

    fn active_level(cfg_level: &str, want_active: bool) -> bool {
        match cfg_level {
            "low" => !want_active,   // active-low: active=true → set LOW(false)
            _ => want_active,         // active-high: active=true → set HIGH(true)
        }
    }

    // Resolve which pin does what + its active level
    let reset_pin = if cfg.rts_function == "reset" { "rts" }
        else if cfg.dtr_function == "reset" { "dtr" } else { "" };
    let boot0_pin = if cfg.rts_function == "bootloader" { "rts" }
        else if cfg.dtr_function == "bootloader" { "dtr" } else { "" };
    let reset_lvl = if cfg.rts_function == "reset" { &cfg.rts_active_level }
        else if cfg.dtr_function == "reset" { &cfg.dtr_active_level } else { "" };
    let boot0_lvl = if cfg.rts_function == "bootloader" { &cfg.rts_active_level }
        else if cfg.dtr_function == "bootloader" { &cfg.dtr_active_level } else { "" };

    // 1. De-assert everything first (clean start, ensures edges)
    if reset_pin != "" { let _ = set_pin(isp, reset_pin, active_level(reset_lvl, false)); }
    if boot0_pin != "" { let _ = set_pin(isp, boot0_pin, active_level(boot0_lvl, false)); }
    sleep(Duration::from_millis(10));

    // 2. Assert BOOT0 first and let it settle, to mimic the user clicking
    // "read chip" and pressing RESET a moment later.
    if boot0_pin != "" { set_pin(isp, boot0_pin, active_level(boot0_lvl, true))?; }
    sleep(Duration::from_millis(80));

    // 3. Pulse RESET while BOOT0 stays asserted.
    if reset_pin != "" { set_pin(isp, reset_pin, active_level(reset_lvl, true))?; }
    sleep(Duration::from_millis(100));

    // 4. Release RESET (BOOT0 stays asserted → chip boots into bootloader)
    if reset_pin != "" { set_pin(isp, reset_pin, active_level(reset_lvl, false))?; }
    sleep(Duration::from_millis(120));

    Ok(())
}

fn dtr_rts_run_mode(isp: &mut Stm32Isp, cfg: &DtrRtsConfig) -> Result<(), AppError> {
    use std::thread::sleep;
    use std::time::Duration;

    fn active_level(cfg_level: &str, want_active: bool) -> bool {
        match cfg_level { "low" => !want_active, _ => want_active }
    }

    // De-assert BOOT0, assert RESET, release RESET
    let boot0_pin = if cfg.rts_function == "bootloader" { ("rts", &cfg.rts_active_level) }
        else if cfg.dtr_function == "bootloader" { ("dtr", &cfg.dtr_active_level) }
        else { return Ok(()) };
    let reset_pin = if cfg.rts_function == "reset" { ("rts", &cfg.rts_active_level) }
        else if cfg.dtr_function == "reset" { ("dtr", &cfg.dtr_active_level) }
        else { ("", &String::new()) };

    // BOOT0 off → normal mode
    let lvl = active_level(boot0_pin.1, false);
    if boot0_pin.0 == "rts" { isp.set_rts(lvl)?; } else { isp.set_dtr(lvl)?; }

    if reset_pin.0 != "" {
        // Pulse RESET
        let lvl = active_level(reset_pin.1, true);
        if reset_pin.0 == "rts" { isp.set_rts(lvl)?; } else { isp.set_dtr(lvl)?; }
        sleep(Duration::from_millis(10));
        let lvl = active_level(reset_pin.1, false);
        if reset_pin.0 == "rts" { isp.set_rts(lvl)?; } else { isp.set_dtr(lvl)?; }
    }

    Ok(())
}

// ─── Helper: open port + enter bootloader ───
fn connect_and_enter(
    port_name: &str,
    baud_rate: u32,
    auto_reset: bool,
    dtr_rts: &DtrRtsConfig,
    app: &AppHandle,
) -> Result<Stm32Isp, AppError> {
    use std::time::Duration;

    emit_progress(app, "connecting", 5, &format!("Opening {} @ {} baud...", port_name, baud_rate));

    let serial_port = serialport::new(port_name, baud_rate)
        .timeout(std::time::Duration::from_secs(5))
        .parity(serialport::Parity::Even)
        .stop_bits(serialport::StopBits::One)
        .flow_control(serialport::FlowControl::None)
        .open()
        .map_err(|e| AppError::SerialError(format!("Cannot open {}: {}", port_name, e)))?;

    let mut isp = Stm32Isp::new(serial_port)?;
    // Let the USB-to-serial adapter settle
    std::thread::sleep(std::time::Duration::from_millis(100));

    let app_clone = app.clone();
    let sync_logger = |bytes: &[u8]| {
        let s: String = bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let _ = app_clone.emit("flash-progress", FlashProgressEvent {
            stage: "sync".into(),
            percent: 0,
            message: format!("RX: {}", s),
        });
    };

    if auto_reset {
        let attempts = 3;
        let mut last_error: Option<AppError> = None;

        for attempt in 1..=attempts {
            emit_progress(
                app,
                "bootloader",
                10,
                &format!("DTR/RTS: entering bootloader (attempt {}/{})...", attempt, attempts),
            );
            dtr_rts_enter_bootloader(&mut isp, dtr_rts)?;

            emit_progress(
                app,
                "bootloader",
                15,
                &format!("Sync (0x7F)... attempt {}/{}", attempt, attempts),
            );

            match isp.enter_bootloader_with_timeout(Duration::from_secs(2), &sync_logger) {
                Ok(()) => {
                    emit_progress(app, "bootloader", 20, "Sync OK");
                    return Ok(isp);
                }
                Err(err) => {
                    emit_progress(
                        app,
                        "bootloader",
                        18,
                        &format!("No bootloader response on attempt {}, retrying...", attempt),
                    );
                    last_error = Some(err);
                }
            }
        }

        return Err(last_error.unwrap_or_else(|| AppError::FlashError("Failed to enter bootloader".into())));
    }

    emit_progress(app, "bootloader", 15, "Sync (0x7F)...");
    isp.enter_bootloader(&sync_logger)?;
    emit_progress(app, "bootloader", 20, "Sync OK");
    Ok(isp)
}

fn reenter_bootloader(
    isp: &mut Stm32Isp,
    auto_reset: bool,
    dtr_rts: &DtrRtsConfig,
    app: &AppHandle,
) -> Result<(), AppError> {
    use std::time::Duration;

    let app_clone = app.clone();
    let sync_logger = |bytes: &[u8]| {
        let s: String = bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let _ = app_clone.emit("flash-progress", FlashProgressEvent {
            stage: "sync".into(),
            percent: 0,
            message: format!("RX: {}", s),
        });
    };

    if auto_reset {
        let attempts = 3;
        let mut last_error: Option<AppError> = None;

        for attempt in 1..=attempts {
            emit_progress(
                app,
                "bootloader",
                45,
                &format!("Re-entering bootloader (attempt {}/{})...", attempt, attempts),
            );
            dtr_rts_enter_bootloader(isp, dtr_rts)?;

            match isp.enter_bootloader_with_timeout(Duration::from_secs(2), &sync_logger) {
                Ok(()) => {
                    emit_progress(app, "bootloader", 48, "Bootloader re-entry OK");
                    return Ok(());
                }
                Err(err) => last_error = Some(err),
            }
        }

        Err(last_error.unwrap_or_else(|| AppError::FlashError("Failed to re-enter bootloader".into())))
    } else {
        isp.enter_bootloader(&sync_logger)
    }
}

fn try_unprotect_and_reenter(
    isp: &mut Stm32Isp,
    auto_reset: bool,
    dtr_rts: &DtrRtsConfig,
    app: &AppHandle,
) -> Result<(), AppError> {
    emit_progress(app, "bootloader", 38, "Erase denied. Trying Write Unprotect...");
    match isp.write_unprotect() {
        Ok(()) => reenter_bootloader(isp, auto_reset, dtr_rts, app),
        Err(write_err) => {
            emit_progress(
                app,
                "bootloader",
                38,
                "Write Unprotect was denied. Trying Readout Unprotect (this resets and mass-erases the chip)...",
            );
            isp.readout_unprotect().map_err(|readout_err| {
                AppError::FlashError(format!(
                    "Write Unprotect failed: {}. Readout Unprotect failed: {}",
                    write_err, readout_err
                ))
            })?;
            reenter_bootloader(isp, auto_reset, dtr_rts, app)
        }
    }
}

fn erase_with_recovery(
    isp: &mut Stm32Isp,
    bootloader_commands: &[u8],
    auto_reset: bool,
    dtr_rts: &DtrRtsConfig,
    app: &AppHandle,
    version_status_bytes: &[u8],
) -> Result<(), AppError> {
    if let Err(err) = isp.erase_flash(bootloader_commands) {
        let err_text = err.to_string();
        if err_text.contains("denied")
            || err_text.contains("Cmd 43 bad response [1f]")
            || err_text.contains("Cmd 44 bad response [1f]")
        {
            try_unprotect_and_reenter(isp, auto_reset, dtr_rts, app)?;
            emit_progress(app, "erasing", 39, "Retrying erase after unprotect...");
            isp.erase_flash(bootloader_commands)?;
            return Ok(());
        }

        return Err(AppError::FlashError(format!(
            "{} Bootloader status bytes: {}",
            err,
            if version_status_bytes.is_empty() {
                "none".into()
            } else {
                version_status_bytes
                    .iter()
                    .map(|b| format!("{:02x}", b))
                    .collect::<Vec<_>>()
                    .join(" ")
            }
        )));
    }

    Ok(())
}

// ─── Helper: detect chip ───
fn detect_chip(isp: &mut Stm32Isp, app: &AppHandle) -> Result<ChipInfoResult, AppError> {
    emit_progress(app, "detecting", 25, "Sending Get (0x00)...");

    // Get (0x00) MUST be first command after sync – returns version + supported cmds
    let (version, _cmds) = isp.get_commands()?;

    emit_progress(app, "detecting", 28, &format!("Bootloader v{}.{}, reading chip ID...", version >> 4, version & 0xF));
    let (device_id, pid) = isp.get_chip_id()?;

    let chip_match = chips::find_chip_by_device_id(device_id);

    emit_progress(app, "detecting", 30, &format!(
        "Device ID: {:#06x}, PID: {:?}, Bootloader: v{}.{}",
        device_id, pid, version >> 4, version & 0x0F
    ));

    Ok(ChipInfoResult {
        device_id,
        device_id_hex: format!("{:#06x}", device_id),
        pid,
        bootloader_version: version,
        chip_match,
    })
}

fn validate_firmware_segments(
    firmware: &crate::firmware::FirmwareData,
    chip: &Stm32ChipInfo,
) -> Result<(), AppError> {
    let flash_end = chip.flash_start + chip.flash_kb * 1024;
    let mut ranges: Vec<(u32, u32)> = firmware
        .segments
        .iter()
        .map(|segment| (segment.address, segment.address + segment.data.len() as u32))
        .collect();
    ranges.sort_by_key(|(start, _)| *start);

    for (index, seg) in firmware.segments.iter().enumerate() {
        let seg_end = seg.address + seg.data.len() as u32;
        if seg.address % 4 != 0 {
            return Err(AppError::FlashError(format!(
                "Firmware segment starts at non-4-byte-aligned address {:#010X}",
                seg.address
            )));
        }
        if seg.address < chip.flash_start || seg_end > flash_end {
            return Err(AppError::FlashError(format!(
                "Firmware segment {:#010X}-{:#010X} outside flash range ({:#010X}-{:#010X})",
                seg.address, seg_end, chip.flash_start, flash_end
            )));
        }
        if index > 0 {
            let (prev_start, prev_end) = ranges[index - 1];
            let (curr_start, curr_end) = ranges[index];
            if curr_start < prev_end {
                return Err(AppError::FlashError(format!(
                    "Firmware segments overlap: {:#010X}-{:#010X} overlaps {:#010X}-{:#010X}",
                    prev_start, prev_end, curr_start, curr_end
                )));
            }
        }
    }

    Ok(())
}

// ─── Helper: write firmware ───
fn write_firmware(
    isp: &mut Stm32Isp,
    firmware: &crate::firmware::FirmwareData,
    app: &AppHandle,
) -> Result<(), AppError> {
    let total: usize = firmware.segments.iter().map(|s| s.data.len()).sum();
    let mut written = 0usize;

    emit_progress(app, "writing", 50, &format!("Writing {} bytes in {} segment(s)...", total, firmware.segments.len()));

    for (i, seg) in firmware.segments.iter().enumerate() {
        isp.write_memory_with_progress(seg.address, &seg.data, |chunk_addr, chunk_len| {
            written += chunk_len;
            let pct = 50 + ((written as f64 / total as f64) * 40.0) as u8;
            emit_progress(app, "writing", pct.min(90), &format!(
                "Segment {}/{}: {:#010X} ({}/{} bytes)",
                i + 1,
                firmware.segments.len(),
                chunk_addr,
                written,
                total
            ));
        })?;
    }

    emit_progress(app, "writing", 90, "Write complete");
    Ok(())
}

// ═══════════════════════════════════════════════════════
// Tauri Commands
// ═══════════════════════════════════════════════════════

/// Parse a firmware file and return info
#[tauri::command]
pub fn parse_firmware(file_path: String, base_address: Option<u32>) -> Result<FirmwareInfo, AppError> {
    parse_firmware_with_cache_inner(file_path, base_address, None)
}

fn parse_firmware_with_cache_inner(
    file_path: String,
    base_address: Option<u32>,
    state: Option<&State<AppState>>,
) -> Result<FirmwareInfo, AppError> {
    let path = Path::new(&file_path);
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let data = fs::read(&file_path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let firmware = match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(&filename, &data)?,
        "bin" => bin::parse_bin(&filename, &data, base_address.unwrap_or(0x0800_0000))?,
        "" => {
            return Err(AppError::FirmwareParseError(
                "Firmware file must have a supported extension (.hex, .ihx, .bin)".into(),
            ));
        }
        _ => {
            return Err(AppError::FirmwareParseError(format!(
                "Unsupported firmware format '.{}'. Only .hex/.ihx/.bin are currently supported.",
                ext
            )));
        }
    };

    if let Some(state) = state {
        let (size, modified_ms) = file_signature(&file_path)?;
        state
            .parsed_firmware_cache
            .write()
            .insert(
                file_path.clone(),
                FirmwareCacheEntry {
                    size,
                    modified_ms,
                    firmware: firmware.clone(),
                },
            );
    }

    let mut hasher = Sha256::new();
    for seg in &firmware.segments { hasher.update(&seg.data); }

    let format_name = match firmware.source_format {
        crate::firmware::FirmwareFormat::Hex => "Intel HEX".to_string(),
        crate::firmware::FirmwareFormat::Bin => "Binary".to_string(),
        _ => "Unknown".to_string(),
    };

    Ok(FirmwareInfo {
        filename: firmware.filename,
        format: format_name,
        size: firmware.total_size,
        segments: firmware.segments.iter().map(|s| SegmentInfo {
            address: s.address,
            size: s.data.len(),
            range: format!("{:#010X} - {:#010X}", s.address, s.address + s.data.len() as u32),
        }).collect(),
        checksum: format!("{:x}", hasher.finalize()),
    })
}

#[tauri::command]
pub fn parse_firmware_cached(
    state: State<AppState>,
    file_path: String,
    base_address: Option<u32>,
) -> Result<FirmwareInfo, AppError> {
    parse_firmware_with_cache_inner(file_path, base_address, Some(&state))
}

/// Connect, detect chip, and return chip info — read-only, no erase/write
#[tauri::command]
pub async fn read_chip_info(
    app: AppHandle,
    port_name: String,
    baud_rate: u32,
    options: Option<ConnectOptions>,
) -> Result<ChipInfoResult, AppError> {
    let options = options.unwrap_or(ConnectOptions {
        auto_reset: false,
        dtr_rts: DtrRtsConfig::default(),
    });
    let mut isp = connect_and_enter(
        &port_name,
        baud_rate,
        options.auto_reset,
        &options.dtr_rts,
        &app,
    )?;
    detect_chip(&mut isp, &app)
}

/// Erase chip flash (standalone)
#[tauri::command]
pub async fn erase_chip(
    app: AppHandle,
    port_name: String,
    baud_rate: u32,
    options: Option<ConnectOptions>,
) -> Result<(), AppError> {
    let options = options.unwrap_or(ConnectOptions {
        auto_reset: false,
        dtr_rts: DtrRtsConfig::default(),
    });
    let mut isp = connect_and_enter(
        &port_name,
        baud_rate,
        options.auto_reset,
        &options.dtr_rts,
        &app,
    )?;

    emit_progress(&app, "detecting", 25, "Sending Get (0x00)...");
    let (bootloader_version, bootloader_commands) = isp.get_commands()?;
    let (_version_status, version_status_bytes) = isp.get_bootloader_version().unwrap_or((bootloader_version, vec![]));
    emit_progress(
        &app,
        "detecting",
        28,
        &format!(
            "Bootloader v{}.{}, reading chip ID...",
            bootloader_version >> 4,
            bootloader_version & 0xF
        ),
    );
    let (device_id, pid) = isp.get_chip_id()?;
    emit_progress(
        &app,
        "detecting",
        30,
        &format!(
            "Device ID: {:#06x}, PID: {:?}, Bootloader: v{}.{}{}",
            device_id,
            pid,
            bootloader_version >> 4,
            bootloader_version & 0x0F,
            if version_status_bytes.is_empty() {
                String::new()
            } else {
                format!(
                    ", Status: {}",
                    version_status_bytes
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            }
        ),
    );

    emit_progress(&app, "erasing", 35, "Erasing flash...");
    erase_with_recovery(
        &mut isp,
        &bootloader_commands,
        options.auto_reset,
        &options.dtr_rts,
        &app,
        &version_status_bytes,
    )?;
    emit_progress(&app, "erasing", 100, "Erase complete");

    Ok(())
}

/// Read flash memory range and save to file
#[tauri::command]
pub async fn read_flash(
    app: AppHandle,
    port_name: String,
    baud_rate: u32,
    options: Option<ConnectOptions>,
    start_address: u32,
    size: u32,
    save_path: String,
) -> Result<(), AppError> {
    const READ_PROGRESS_STEP: usize = 4096;

    let options = options.unwrap_or(ConnectOptions {
        auto_reset: false,
        dtr_rts: DtrRtsConfig::default(),
    });
    let mut isp = connect_and_enter(
        &port_name,
        baud_rate,
        options.auto_reset,
        &options.dtr_rts,
        &app,
    )?;

    if size == 0 {
        return Err(AppError::FlashError("Read size must be greater than 0".into()));
    }
    if start_address % 4 != 0 {
        return Err(AppError::FlashError(format!(
            "Read start address {:#010X} must be 4-byte aligned",
            start_address
        )));
    }
    let end_address = start_address
        .checked_add(size)
        .ok_or_else(|| AppError::FlashError("Read range overflows 32-bit address space".into()))?;
    if end_address < start_address {
        return Err(AppError::FlashError("Read range is invalid".into()));
    }

    emit_progress(&app, "reading", 0, &format!(
        "Reading {:#010X} - {:#010X} ({} bytes)...",
        start_address, start_address + size, size
    ));

    // Read in 256-byte chunks (ISP max)
    let mut data = Vec::with_capacity(size as usize);
    let mut addr = start_address;
    let total = size as usize;
    let read_start = Instant::now();
    let mut last_reported = 0usize;

    while data.len() < total {
        let remaining = total - data.len();
        let chunk_size = remaining.min(256);

        let chunk = isp.read_memory(addr, chunk_size)?;
        data.extend_from_slice(&chunk);

        let current_len = data.len();
        let should_report = current_len == total
            || current_len.saturating_sub(last_reported) >= READ_PROGRESS_STEP;
        if should_report {
            let pct = (current_len as f64 / total as f64 * 100.0) as u8;
            let elapsed = read_start.elapsed().as_secs_f64().max(0.001);
            let kbps = current_len as f64 / 1024.0 / elapsed;
            emit_progress(&app, "reading", pct, &format!(
                "Read {}/{} bytes from {:#010X} ({:.1} KB/s)",
                current_len,
                total,
                addr,
                kbps
            ));
            last_reported = current_len;
        }

        addr += chunk_size as u32;
    }

    fs::write(&save_path, &data)
        .map_err(|e| AppError::Generic(format!("Cannot save file: {}", e)))?;

    emit_progress(&app, "complete", 100, &format!(
        "Saved {} bytes to {}", data.len(), save_path
    ));

    Ok(())
}

/// Full flash flow: parse → connect → detect → erase → write → [verify] → [run]
#[tauri::command]
pub async fn start_flash(
    app: AppHandle,
    state: State<'_, AppState>,
    firmware_path: String,
    port_name: String,
    baud_rate: u32,
    options: FlashOptions,
) -> Result<(), AppError> {
    let start = Instant::now();

    // 1. Parse firmware
    emit_progress(&app, "parsing", 0, "Parsing firmware...");
    let (size, modified_ms) = file_signature(&firmware_path)?;
    let firmware = if let Some(cached) = state.parsed_firmware_cache.read().get(&firmware_path).cloned() {
        if cached.size == size && cached.modified_ms == modified_ms {
            cached.firmware
        } else {
            let data = fs::read(&firmware_path)
                .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
            let parsed = parse_supported_firmware_from_path(&firmware_path, &data)?;
            state.parsed_firmware_cache.write().insert(
                firmware_path.clone(),
                FirmwareCacheEntry {
                    size,
                    modified_ms,
                    firmware: parsed.clone(),
                },
            );
            parsed
        }
    } else {
        let data = fs::read(&firmware_path)
            .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
        let parsed = parse_supported_firmware_from_path(&firmware_path, &data)?;
        state
            .parsed_firmware_cache
            .write()
            .insert(
                firmware_path.clone(),
                FirmwareCacheEntry {
                    size,
                    modified_ms,
                    firmware: parsed.clone(),
                },
            );
        parsed
    };

    if firmware.segments.is_empty() {
        return Err(AppError::FirmwareParseError("No data in firmware".into()));
    }

    let total_size: usize = firmware.segments.iter().map(|s| s.data.len()).sum();
    emit_progress(&app, "parsing", 5, &format!(
        "Firmware: {} bytes, {} segment(s)", total_size, firmware.segments.len()
    ));

    // 2. Connect + enter bootloader
    let mut isp = connect_and_enter(&port_name, baud_rate, options.auto_reset, &options.dtr_rts, &app)?;

    // 3. Detect chip
    emit_progress(&app, "detecting", 25, "Sending Get (0x00)...");
    let (bootloader_version, bootloader_commands) = isp.get_commands()?;
    emit_progress(
        &app,
        "detecting",
        28,
        &format!(
            "Bootloader v{}.{}, reading chip ID...",
            bootloader_version >> 4,
            bootloader_version & 0xF
        ),
    );
    let (device_id, pid) = isp.get_chip_id()?;
    let chip_match = chips::find_chip_by_device_id(device_id);
    let chip_info = ChipInfoResult {
        device_id,
        device_id_hex: format!("{:#06x}", device_id),
        pid,
        bootloader_version,
        chip_match,
    };
    emit_progress(
        &app,
        "detecting",
        30,
        &format!(
            "Device ID: {:#06x}, PID: {:?}, Bootloader: v{}.{}",
            device_id,
            pid,
            bootloader_version >> 4,
            bootloader_version & 0x0F
        ),
    );

    let chip = chip_info.chip_match.as_ref().ok_or_else(|| {
        AppError::UnsupportedChip(format!(
            "Unknown chip (device_id={}). Select a chip manually or add it to the database.",
            chip_info.device_id_hex
        ))
    })?;

    validate_firmware_segments(&firmware, chip)?;

    // 4. Erase
    emit_progress(&app, "erasing", 35, &format!(
        "Erasing {} ({})...", chip.name, chip.flash_kb
    ));
    emit_progress(&app, "erasing", 36, "Mass erase can take tens of seconds on STM32F4; waiting for bootloader ACK...");
    erase_with_recovery(
        &mut isp,
        &bootloader_commands,
        options.auto_reset,
        &options.dtr_rts,
        &app,
        &[],
    )?;

    // Erase resets the chip on many STM32 models – re-enter bootloader
    emit_progress(&app, "bootloader", 45, "Re-entering bootloader after erase...");
    reenter_bootloader(&mut isp, options.auto_reset, &options.dtr_rts, &app)?;

    // 5. Write
    write_firmware(&mut isp, &firmware, &app)?;

    // 6. Verify (optional)
    if options.verify {
        emit_progress(&app, "verifying", 92, "Verifying...");
        let total_verify = firmware.segments.iter().map(|s| s.data.len()).sum::<usize>();
        let mut verified = 0usize;
        for seg in &firmware.segments {
            isp.verify_memory_with_progress(seg.address, &seg.data, |chunk_addr, chunk_len| {
                verified += chunk_len;
                let pct = 92 + ((verified as f64 / total_verify as f64) * 6.0) as u8;
                emit_progress(&app, "verifying", pct.min(98), &format!(
                    "Verifying {:#010X} ({}/{} bytes)",
                    chunk_addr,
                    verified,
                    total_verify
                ));
            })?;
        }
        emit_progress(&app, "verifying", 98, "Verification passed");
    }

    // 7. Run (optional)
    if options.run_after {
        emit_progress(&app, "resetting", 99, "Starting application...");

        if options.auto_reset {
            dtr_rts_run_mode(&mut isp, &options.dtr_rts)?;
        } else {
            let entry = chip.flash_start;
            isp.go(entry)?;
        }
    }

    let elapsed = start.elapsed();
    emit_progress(&app, "complete", 100, &format!(
        "Done: {} bytes in {:.1}s", total_size, elapsed.as_secs_f64()
    ));

    Ok(())
}

#[tauri::command]
pub fn cancel_flash() -> Result<(), String> {
    Ok(())
}
