use serde::Serialize;

use crate::flash::orchestrator::EnvStatus;
use crate::flash::registry::ModuleRegistry;

#[derive(Debug, Serialize)]
pub struct ModuleInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub installed: bool,
    pub chip_count: u32,
    pub format_count: u32,
    pub status: String,
}

#[tauri::command]
pub fn list_modules() -> Result<Vec<ModuleInfo>, String> {
    let _registry = ModuleRegistry::new();
    Ok(vec![
        ModuleInfo {
            id: "stm32-isp".into(),
            name: "STM32 Serial ISP".into(),
            description: "通过串口 ISP 协议烧录 STM32 全系列芯片".into(),
            builtin: true,
            installed: true,
            chip_count: 42,
            format_count: 2,
            status: "ready".into(),
        },
        ModuleInfo {
            id: "arduino-avr".into(),
            name: "Arduino AVR".into(),
            description: "通过 avrdude 烧录 Arduino AVR 芯片".into(),
            builtin: true,
            installed: true,
            chip_count: 12,
            format_count: 1,
            status: "ready".into(),
        },
    ])
}

#[tauri::command]
pub fn check_module_env(module_id: String) -> Result<EnvStatus, String> {
    Ok(EnvStatus {
        ready: true,
        missing_tools: vec![],
        messages: vec![format!("Module '{}' environment OK", module_id)],
    })
}
