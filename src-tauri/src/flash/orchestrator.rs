use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelpLink {
    pub label: String,
    pub url: String,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolSource {
    System,
    Managed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvStatus {
    pub ready: bool,
    pub can_install: bool,
    pub source: Option<ToolSource>,
    pub missing_tools: Vec<String>,
    pub messages: Vec<String>,
    pub version: Option<String>,
    pub install_hint: Option<String>,
    pub install_steps: Vec<String>,
    pub references: Vec<HelpLink>,
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
