use std::fs;
use std::path::Path;
use std::time::Instant;

use tauri::AppHandle;
use tauri::Emitter;
use serde::{Serialize, Deserialize};
use sha2::{Sha256, Digest};

use crate::error::AppError;
use crate::firmware::{FirmwareInfo, SegmentInfo, bin, hex};
use crate::flash::chips::{self, Stm32ChipInfo};
use crate::flash::stm32_isp::Stm32Isp;

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

    // 2. Assert RESET + BOOT0 simultaneously
    if reset_pin != "" { set_pin(isp, reset_pin, active_level(reset_lvl, true))?; }
    if boot0_pin != "" { set_pin(isp, boot0_pin, active_level(boot0_lvl, true))?; }
    sleep(Duration::from_millis(100));

    // 3. Release RESET (BOOT0 stays asserted → chip boots into bootloader)
    if reset_pin != "" { set_pin(isp, reset_pin, active_level(reset_lvl, false))?; }
    sleep(Duration::from_millis(100));

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

    if auto_reset {
        emit_progress(app, "bootloader", 10, "DTR/RTS: entering bootloader...");
        dtr_rts_enter_bootloader(&mut isp, dtr_rts)?;
    }

    emit_progress(app, "bootloader", 15, "Sync (0x7F)...");
    let app_clone = app.clone();
    isp.enter_bootloader(&|bytes: &[u8]| {
        let s: String = bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let _ = app_clone.emit("flash-progress", FlashProgressEvent {
            stage: "sync".into(),
            percent: 0,
            message: format!("RX: {}", s),
        });
    })?;
    emit_progress(app, "bootloader", 20, "Sync OK");
    Ok(isp)
}

// ─── Helper: detect chip ───
fn detect_chip(isp: &mut Stm32Isp, app: &AppHandle) -> Result<ChipInfoResult, AppError> {
    emit_progress(app, "detecting", 25, "Sending Get (0x00)...");

    // Get (0x00) MUST be first command after sync — returns version + supported cmds
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
        isp.write_memory(seg.address, &seg.data)?;
        written += seg.data.len();
        let pct = 50 + ((written as f64 / total as f64) * 40.0) as u8;
        emit_progress(app, "writing", pct.min(90), &format!(
            "Segment {}/{}: {:#010X} ({}/{} bytes)",
            i + 1, firmware.segments.len(), seg.address, written, total
        ));
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
    let path = Path::new(&file_path);
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let data = fs::read(&file_path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let firmware = match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(&filename, &data)?,
        "bin" => bin::parse_bin(&filename, &data, base_address.unwrap_or(0x0800_0000))?,
        _ => hex::parse_hex(&filename, &data)
            .or_else(|_| bin::parse_bin(&filename, &data, base_address.unwrap_or(0x0800_0000)))?,
    };

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

    let _chip = detect_chip(&mut isp, &app)?;

    emit_progress(&app, "erasing", 35, "Erasing flash...");
    isp.erase_flash()?;
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

    emit_progress(&app, "reading", 0, &format!(
        "Reading {:#010X} - {:#010X} ({} bytes)...",
        start_address, start_address + size, size
    ));

    // Read in 256-byte chunks (ISP max)
    let mut data = Vec::with_capacity(size as usize);
    let mut addr = start_address;
    let total = size as usize;

    while data.len() < total {
        let remaining = total - data.len();
        let chunk_size = remaining.min(256) as u8;

        let chunk = isp.read_memory(addr, chunk_size as usize)?;
        data.extend_from_slice(&chunk);

        let pct = (data.len() as f64 / total as f64 * 100.0) as u8;
        emit_progress(&app, "reading", pct, &format!(
            "Read {}/{} bytes from {:#010X}", data.len(), total, addr
        ));

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
    firmware_path: String,
    port_name: String,
    baud_rate: u32,
    options: FlashOptions,
) -> Result<(), AppError> {
    let start = Instant::now();

    // 1. Parse firmware
    emit_progress(&app, "parsing", 0, "Parsing firmware...");
    let data = fs::read(&firmware_path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;
    let path = Path::new(&firmware_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let firmware = match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex("firmware", &data)?,
        _ => bin::parse_bin("firmware", &data, 0x0800_0000)?,
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
    let chip_info = detect_chip(&mut isp, &app)?;

    let chip = chip_info.chip_match.as_ref().ok_or_else(|| {
        AppError::UnsupportedChip(format!(
            "Unknown chip (device_id={}). Select a chip manually or add it to the database.",
            chip_info.device_id_hex
        ))
    })?;

    // Validate firmware fits
    let flash_end = chip.flash_start + chip.flash_kb * 1024;
    for seg in &firmware.segments {
        let seg_end = seg.address + seg.data.len() as u32;
        if seg.address < chip.flash_start || seg_end > flash_end {
            return Err(AppError::FlashError(format!(
                "Firmware segment {:#010X}-{:#010X} outside flash range ({:#010X}-{:#010X})",
                seg.address, seg_end, chip.flash_start, flash_end
            )));
        }
    }

    // 4. Erase
    emit_progress(&app, "erasing", 35, &format!(
        "Erasing {} ({})...", chip.name, chip.flash_kb
    ));
    isp.erase_flash()?;

    // Erase resets the chip on many STM32 models — re-enter bootloader
    emit_progress(&app, "bootloader", 45, "Re-entering bootloader after erase...");
    if options.auto_reset {
        dtr_rts_enter_bootloader(&mut isp, &options.dtr_rts)?;
    }
    isp.enter_bootloader(&|bytes: &[u8]| {
        let s: String = bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let _ = app.emit("flash-progress", FlashProgressEvent {
            stage: "sync".into(), percent: 0, message: format!("RX: {}", s),
        });
    })?;

    // 5. Write
    write_firmware(&mut isp, &firmware, &app)?;

    // 6. Verify (optional)
    if options.verify {
        emit_progress(&app, "verifying", 92, "Verifying...");
        for seg in &firmware.segments {
            isp.verify_memory(seg.address, &seg.data)?;
        }
        emit_progress(&app, "verifying", 98, "Verification passed");
    }

    // 7. Run (optional)
    if options.run_after {
        emit_progress(&app, "resetting", 99, "Starting application...");

        if options.auto_reset {
            dtr_rts_run_mode(&mut isp, &options.dtr_rts)?;
        } else {
            let entry = firmware.segments.first().map(|s| s.address).unwrap_or(chip.flash_start);
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
