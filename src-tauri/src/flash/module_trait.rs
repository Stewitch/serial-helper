use serde::Serialize;

use super::orchestrator::EnvStatus;

/// A chip a module can flash, as the frontend needs it to draw the flash map.
#[derive(Debug, Clone, Serialize)]
pub struct ModuleChip {
    /// Value the module's flash options use to name this chip.
    pub id: String,
    pub name: String,
    pub flash_kb: u32,
    pub ram_kb: f32,
    pub flash_start: u32,
    pub page_size: u32,
}

/// How the module finds out which chip is attached.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChipSelection {
    /// The chip answers with an ID; the user can detect it before flashing.
    Detect,
    /// The user picks the chip; the tool does not identify it.
    Manual,
    /// The user picks the chip for the map, the tool confirms it while flashing.
    ManualConfirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModuleAvailability {
    /// Ships with the app and can flash once its tools are present.
    Available,
    /// Listed so users know it is coming; cannot flash yet.
    Planned,
}

/// Static description of a flashing module.
#[derive(Debug, Clone, Serialize)]
pub struct ModuleDescriptor {
    pub id: &'static str,
    /// English fallback; the frontend shows a translated name when it has one.
    pub name: &'static str,
    pub description: &'static str,
    pub builtin: bool,
    pub availability: ModuleAvailability,
    pub chip_selection: ChipSelection,
    pub chips: Vec<ModuleChip>,
    /// Firmware file extensions the module accepts.
    pub formats: Vec<&'static str>,
    /// External tools the module runs.
    pub required_tools: Vec<&'static str>,
}

pub trait FlashModule: Send + Sync {
    fn descriptor(&self) -> ModuleDescriptor;

    /// Checks external tools. Runs commands, so call it off the UI thread.
    fn check_environment(&self) -> EnvStatus;
}
