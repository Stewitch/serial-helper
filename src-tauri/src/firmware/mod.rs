pub mod bin;
pub mod hex;

use serde::{Deserialize, Serialize};
use std::ops::Range;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySegment {
    pub address: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareData {
    pub filename: String,
    pub source_format: FirmwareFormat,
    pub segments: Vec<MemorySegment>,
    pub total_size: usize,
    pub address_range: Option<Range<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FirmwareFormat {
    Hex,
    Bin,
    Srec,
    Elf,
    Dfu,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirmwareInfo {
    pub filename: String,
    pub format: String,
    pub size: usize,
    pub segments: Vec<SegmentInfo>,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentInfo {
    pub address: u32,
    pub size: usize,
    pub range: String,
}
