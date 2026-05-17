use crate::error::{AppError, AppResult};
use super::{FirmwareData, FirmwareFormat, MemorySegment};

pub fn parse_hex(filename: &str, data: &[u8]) -> AppResult<FirmwareData> {
    let text = std::str::from_utf8(data)
        .map_err(|e| AppError::FirmwareParseError(format!("Invalid UTF-8: {}", e)))?;

    let mut segments: Vec<MemorySegment> = Vec::new();
    let mut current_data: Vec<u8> = Vec::new();
    let mut base_address: u32 = 0;
    let mut current_segment_start: Option<u32> = None;

    for (line_num, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if !line.starts_with(':') {
            return Err(AppError::FirmwareParseError(format!(
                "Line {}: missing ':' prefix", line_num + 1
            )));
        }

        let hex_data = &line[1..];
        if hex_data.len() < 2 {
            return Err(AppError::FirmwareParseError(format!(
                "Line {}: too short", line_num + 1
            )));
        }

        let bytes = hex::decode(hex_data).map_err(|e| {
            AppError::FirmwareParseError(format!("Line {}: invalid hex: {}", line_num + 1, e))
        })?;

        // Validate checksum
        let sum: u8 = bytes.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
        if sum != 0 {
            return Err(AppError::FirmwareParseError(format!(
                "Line {}: checksum mismatch (sum={:#04x})", line_num + 1, sum
            )));
        }

        // bytes[0] = byte count, bytes[1..3] = address, bytes[3] = record type
        if bytes.len() < 4 {
            return Err(AppError::FirmwareParseError(format!(
                "Line {}: missing header", line_num + 1
            )));
        }

        let count = bytes[0] as usize;
        let address = u16::from_be_bytes([bytes[1], bytes[2]]) as u32;
        let record_type = bytes[3];

        // bytes[4..4+count] = data, last byte = checksum (already verified)
        if bytes.len() != count + 5 {
            return Err(AppError::FirmwareParseError(format!(
                "Line {}: byte count mismatch: expected {}, got {} data bytes",
                line_num + 1,
                count,
                bytes.len() - 5
            )));
        }

        match record_type {
            0x00 => {
                // Data record
                if count == 0 {
                    continue;
                }
                let abs_address = base_address + address;

                // Check if this continues a contiguous segment
                if let Some(start) = current_segment_start {
                    let expected = start + current_data.len() as u32;
                    if abs_address != expected {
                        // Gap — flush current segment
                        if !current_data.is_empty() {
                            segments.push(MemorySegment {
                                address: start,
                                data: std::mem::take(&mut current_data),
                            });
                        }
                        current_segment_start = Some(abs_address);
                    }
                } else {
                    current_segment_start = Some(abs_address);
                }

                current_data.extend_from_slice(&bytes[4..4 + count]);
            }
            0x01 => {
                // EOF
                break;
            }
            0x02 => {
                // Extended segment address (shift left 4)
                if count >= 2 {
                    base_address = u16::from_be_bytes([bytes[4], bytes[5]]) as u32 * 16;
                }
            }
            0x03 => {
                // Start segment address (ignored for flashing)
            }
            0x04 => {
                // Extended linear address (shift left 16)
                if count >= 2 {
                    base_address = u16::from_be_bytes([bytes[4], bytes[5]]) as u32 * 65536;
                }
            }
            0x05 => {
                // Start linear address (ignored for flashing)
            }
            _ => {
                // Unknown record type — skip
            }
        }
    }

    // Flush final segment
    if !current_data.is_empty() {
        if let Some(start) = current_segment_start {
            segments.push(MemorySegment {
                address: start,
                data: current_data,
            });
        }
    }

    let total_size: usize = segments.iter().map(|s| s.data.len()).sum();
    let address_range = if segments.is_empty() {
        None
    } else {
        let min = segments.iter().map(|s| s.address).min().unwrap_or(0);
        let max = segments.iter().map(|s| s.address + s.data.len() as u32).max().unwrap_or(0);
        Some(min..max)
    };

    Ok(FirmwareData {
        filename: filename.to_string(),
        source_format: FirmwareFormat::Hex,
        segments,
        total_size,
        address_range,
    })
}
