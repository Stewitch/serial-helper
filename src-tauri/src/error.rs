use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Port '{0}' not found")]
    PortNotFound(String),

    #[error("Port '{0}' is already in use by another application")]
    PortInUse(String),

    #[error("Port is not open")]
    PortNotOpen,

    #[error("Serial communication error: {0}")]
    SerialError(String),

    #[error("Access denied to port '{0}'")]
    PortAccessDenied(String),

    #[error("Firmware parse error: {0}")]
    FirmwareParseError(String),

    #[error("Unsupported chip: {0}")]
    UnsupportedChip(String),

    #[error("Tool not found: {tool}. Install with: {install_cmd}")]
    ToolNotFound { tool: String, install_cmd: String },

    #[error("Flash failed: {0}")]
    FlashError(String),

    #[error("Flash cancelled by user")]
    FlashCancelled,

    #[error("Verify failed at address {addr:#010X}: expected {expected:#04X}, got {actual:#04X}")]
    VerifyFailed {
        addr: u32,
        expected: u8,
        actual: u8,
    },

    #[error("{0}")]
    Generic(String),
}

// Serialize as human-readable error message, not variant name
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<serialport::Error> for AppError {
    fn from(e: serialport::Error) -> Self {
        AppError::SerialError(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::SerialError(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
