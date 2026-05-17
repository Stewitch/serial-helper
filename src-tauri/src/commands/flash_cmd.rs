use std::fs;
use std::path::Path;

use crate::error::AppError;
use crate::firmware::{FirmwareInfo, SegmentInfo};
use crate::firmware::{bin, hex};
use sha2::{Sha256, Digest};

#[tauri::command]
pub fn parse_firmware(file_path: String, base_address: Option<u32>) -> Result<FirmwareInfo, AppError> {
    let path = Path::new(&file_path);
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let data = fs::read(&file_path)
        .map_err(|e| AppError::FirmwareParseError(format!("Cannot read file: {}", e)))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let firmware = match ext.as_str() {
        "hex" | "ihx" => hex::parse_hex(&filename, &data)?,
        "bin" => bin::parse_bin(&filename, &data, base_address.unwrap_or(0x0800_0000))?,
        _ => {
            // Try hex first, then bin
            if let Ok(fw) = hex::parse_hex(&filename, &data) {
                fw
            } else {
                bin::parse_bin(&filename, &data, base_address.unwrap_or(0x0800_0000))?
            }
        }
    };

    // Compute SHA-256 checksum
    let mut hasher = Sha256::new();
    for seg in &firmware.segments {
        hasher.update(&seg.data);
    }
    let checksum = format!("{:x}", hasher.finalize());

    let format_name = match firmware.source_format {
        crate::firmware::FirmwareFormat::Hex => "Intel HEX".to_string(),
        crate::firmware::FirmwareFormat::Bin => "Binary".to_string(),
        _ => "Unknown".to_string(),
    };

    let segments: Vec<SegmentInfo> = firmware
        .segments
        .iter()
        .map(|s| SegmentInfo {
            address: s.address,
            size: s.data.len(),
            range: format!("{:#010X} - {:#010X}", s.address, s.address + s.data.len() as u32),
        })
        .collect();

    Ok(FirmwareInfo {
        filename: firmware.filename,
        format: format_name,
        size: firmware.total_size,
        segments,
        checksum,
    })
}

#[tauri::command]
pub fn start_flash(
    _module_id: String,
    _chip_family: String,
    _chip_variant: String,
    _firmware_path: String,
) -> Result<(), String> {
    // Phase 2 - protocol implementation in progress
    Err("Flash protocol not yet implemented".to_string())
}

#[tauri::command]
pub fn cancel_flash() -> Result<(), String> {
    Ok(())
}
