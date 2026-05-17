use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChipInfo {
    pub family: String,
    pub variant: String,
    pub ram_kb: u32,
    pub flash_kb: u32,
    pub flash_start: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDependency {
    pub name: String,
    pub check_cmd: String,
    pub install_guide: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FirmwareFormat {
    Hex,
    Bin,
    Srec,
    Elf,
    Dfu,
    Uf2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvStatus {
    pub ready: bool,
    pub missing_tools: Vec<String>,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashProgress {
    pub stage: FlashStage,
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FlashStage {
    EnteringBootloader,
    Erasing,
    Writing,
    Verifying,
    Resetting,
    Complete,
    Error,
}

// Placeholder - will be fleshed out in Phase 2
pub struct FlashOrchestrator;

impl FlashOrchestrator {
    pub fn new() -> Self {
        Self
    }
}
