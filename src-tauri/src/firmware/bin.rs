use crate::error::{AppError, AppResult};
use super::{FirmwareData, FirmwareFormat, MemorySegment};

pub fn parse_bin(filename: &str, data: &[u8], base_address: u32) -> AppResult<FirmwareData> {
    if data.is_empty() {
        return Err(AppError::FirmwareParseError("Binary file is empty".into()));
    }

    let segment = MemorySegment {
        address: base_address,
        data: data.to_vec(),
    };

    let total_size = data.len();
    let end = base_address + total_size as u32;

    Ok(FirmwareData {
        filename: filename.to_string(),
        source_format: FirmwareFormat::Bin,
        segments: vec![segment],
        total_size,
        address_range: Some(base_address..end),
    })
}
