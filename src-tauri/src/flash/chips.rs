use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stm32ChipInfo {
    pub family: String,
    pub name: String,
    pub device_id: u16,
    pub flash_kb: u32,
    pub flash_start: u32,
    pub ram_kb: u32,
    pub page_size: u16,
    pub pid: Option<u16>,
}

/// Common STM32 chips and their properties
pub fn chip_database() -> Vec<Stm32ChipInfo> {
    vec![
        // STM32F1 series
        Stm32ChipInfo {
            family: "STM32F1".into(),
            name: "STM32F103C8".into(),
            device_id: 0x0410,
            flash_kb: 64,
            flash_start: 0x0800_0000,
            ram_kb: 20,
            page_size: 1024,
            pid: Some(0x0410),
        },
        Stm32ChipInfo {
            family: "STM32F1".into(),
            name: "STM32F103CB".into(),
            device_id: 0x0410,
            flash_kb: 128,
            flash_start: 0x0800_0000,
            ram_kb: 20,
            page_size: 1024,
            pid: Some(0x0410),
        },
        Stm32ChipInfo {
            family: "STM32F1".into(),
            name: "STM32F103RB".into(),
            device_id: 0x0410,
            flash_kb: 128,
            flash_start: 0x0800_0000,
            ram_kb: 20,
            page_size: 1024,
            pid: Some(0x0410),
        },
        Stm32ChipInfo {
            family: "STM32F1".into(),
            name: "STM32F103RC".into(),
            device_id: 0x0410,
            flash_kb: 256,
            flash_start: 0x0800_0000,
            ram_kb: 48,
            page_size: 2048,
            pid: Some(0x0410),
        },
        Stm32ChipInfo {
            family: "STM32F1".into(),
            name: "STM32F103VE".into(),
            device_id: 0x0414,
            flash_kb: 512,
            flash_start: 0x0800_0000,
            ram_kb: 64,
            page_size: 2048,
            pid: Some(0x0414),
        },
        // STM32F4 series
        Stm32ChipInfo {
            family: "STM32F4".into(),
            name: "STM32F407VG".into(),
            device_id: 0x0413,
            flash_kb: 1024,
            flash_start: 0x0800_0000,
            ram_kb: 192,
            page_size: 16384,
            pid: Some(0x0413),
        },
        Stm32ChipInfo {
            family: "STM32F4".into(),
            name: "STM32F401RE".into(),
            device_id: 0x0433,
            flash_kb: 512,
            flash_start: 0x0800_0000,
            ram_kb: 96,
            page_size: 16384,
            pid: Some(0x0433),
        },
        // STM32F0 series
        Stm32ChipInfo {
            family: "STM32F0".into(),
            name: "STM32F030F4".into(),
            device_id: 0x0444,
            flash_kb: 16,
            flash_start: 0x0800_0000,
            ram_kb: 4,
            page_size: 1024,
            pid: Some(0x0444),
        },
        // STM32G0 series
        Stm32ChipInfo {
            family: "STM32G0".into(),
            name: "STM32G030F6".into(),
            device_id: 0x0466,
            flash_kb: 32,
            flash_start: 0x0800_0000,
            ram_kb: 8,
            page_size: 2048,
            pid: Some(0x0466),
        },
    ]
}

pub fn find_chip_by_device_id(device_id: u16, pid: Option<u16>) -> Option<Stm32ChipInfo> {
    chip_database()
        .into_iter()
        .find(|c| c.device_id == device_id && (pid.is_none() || c.pid == pid))
}

pub fn find_chip_by_name(name: &str) -> Option<Stm32ChipInfo> {
    chip_database().into_iter().find(|c| c.name == name)
}
