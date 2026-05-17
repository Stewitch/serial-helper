use tauri::State;

use crate::error::AppError;
use crate::serial::config::SerialConfig;
use crate::serial::scanner::{PortInfo, PortScanner};
use crate::state::AppState;

#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>, AppError> {
    Ok(PortScanner::list_ports())
}

#[tauri::command]
pub fn open_port(state: State<AppState>, config: SerialConfig) -> Result<(), AppError> {
    // Validate port exists before attempting to open
    if PortScanner::find_port(&config.port_name).is_none() {
        return Err(AppError::PortNotFound(config.port_name));
    }

    let manager = state.serial_manager.read();
    manager.open(&config)
}

#[tauri::command]
pub fn close_port(state: State<AppState>) -> Result<(), AppError> {
    let manager = state.serial_manager.read();
    manager.close()
}

#[tauri::command]
pub fn write_data(state: State<AppState>, data: Vec<u8>) -> Result<usize, AppError> {
    let manager = state.serial_manager.read();
    manager.write(&data)
}

#[tauri::command]
pub fn read_data(state: State<AppState>) -> Result<Vec<u8>, AppError> {
    let manager = state.serial_manager.read();
    manager.read_available()
}

#[tauri::command]
pub fn serial_is_open(state: State<AppState>) -> Result<bool, AppError> {
    let manager = state.serial_manager.read();
    Ok(manager.is_open())
}

#[tauri::command]
pub fn serial_active_port(state: State<AppState>) -> Result<Option<String>, AppError> {
    let manager = state.serial_manager.read();
    Ok(manager.active_port_name())
}

#[tauri::command]
pub fn serial_set_dtr(state: State<AppState>, enabled: bool) -> Result<(), AppError> {
    let manager = state.serial_manager.read();
    manager.set_dtr(enabled)
}

#[tauri::command]
pub fn serial_set_rts(state: State<AppState>, enabled: bool) -> Result<(), AppError> {
    let manager = state.serial_manager.read();
    manager.set_rts(enabled)
}
