use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stm32ChipInfo {
    pub family: String,
    pub name: String,
    pub device_id: u16,
    pub flash_kb: u32,
    pub flash_start: u32,
    pub ram_kb: u32,
    pub page_size: u32,
}

/// STM32 chip database — used for identification and firmware-size validation.
/// Note: the ISP protocol itself works with virtually ALL STM32 MCUs.
/// Missing chips can still be flashed if the user specifies them by name.
pub fn chip_database() -> Vec<Stm32ChipInfo> {
    vec![
        // ===== STM32F0 =====
        new("STM32F0", "STM32F030F4", 0x0444, 16, 4, 1024),
        new("STM32F0", "STM32F030C8", 0x0444, 64, 8, 1024),
        new("STM32F0", "STM32F051R8", 0x0440, 64, 8, 1024),
        new("STM32F0", "STM32F072CB", 0x0448, 128, 16, 2048),

        // ===== STM32F1 (density determined by flash size; device_id shared within sub-family) =====
        new("STM32F1", "STM32F103C8", 0x0410, 64, 20, 1024),
        new("STM32F1", "STM32F103CB", 0x0410, 128, 20, 1024),
        new("STM32F1", "STM32F103RB", 0x0410, 128, 20, 1024),
        new("STM32F1", "STM32F103RC", 0x0410, 256, 48, 2048),
        new("STM32F1", "STM32F103RE", 0x0410, 512, 64, 2048),
        new("STM32F1", "STM32F103VE", 0x0414, 512, 64, 2048),
        new("STM32F1", "STM32F103ZE", 0x0414, 512, 64, 2048),
        new("STM32F1", "STM32F105RB", 0x0418, 128, 64, 2048),
        new("STM32F1", "STM32F107VC", 0x0418, 256, 64, 2048),

        // ===== STM32F2 =====
        new("STM32F2", "STM32F205RG", 0x0411, 1024, 128, 16384),
        new("STM32F2", "STM32F207VG", 0x0411, 1024, 128, 16384),

        // ===== STM32F3 =====
        new("STM32F3", "STM32F302CB", 0x0422, 128, 32, 2048),
        new("STM32F3", "STM32F303CC", 0x0422, 256, 40, 2048),
        new("STM32F3", "STM32F303RE", 0x0446, 512, 64, 2048),

        // ===== STM32F4 =====
        new("STM32F4", "STM32F401RE", 0x0433, 512, 96, 16384),
        new("STM32F4", "STM32F407VE", 0x0413, 512, 192, 16384),
        new("STM32F4", "STM32F407VG", 0x0413, 1024, 192, 16384),
        new("STM32F4", "STM32F407ZE", 0x0413, 512, 192, 16384),
        new("STM32F4", "STM32F411CE", 0x0431, 512, 128, 16384),
        new("STM32F4", "STM32F411RE", 0x0431, 512, 128, 16384),
        new("STM32F4", "STM32F429ZI", 0x0419, 2048, 256, 16384),
        new("STM32F4", "STM32F446RE", 0x0421, 512, 128, 16384),

        // ===== STM32F7 =====
        new("STM32F7", "STM32F746NG", 0x0451, 1024, 320, 32768),
        new("STM32F7", "STM32F767ZI", 0x0451, 2048, 512, 32768),

        // ===== STM32G0 =====
        new("STM32G0", "STM32G030F6", 0x0466, 32, 8, 2048),
        new("STM32G0", "STM32G031G8", 0x0466, 64, 8, 2048),
        new("STM32G0", "STM32G070RB", 0x0460, 128, 36, 2048),
        new("STM32G0", "STM32G071RB", 0x0460, 128, 36, 2048),

        // ===== STM32G4 =====
        new("STM32G4", "STM32G431CB", 0x0468, 128, 32, 2048),
        new("STM32G4", "STM32G474RE", 0x0469, 512, 128, 2048),

        // ===== STM32H7 =====
        new("STM32H7", "STM32H743ZI", 0x0450, 2048, 1024, 131072),
        new("STM32H7", "STM32H750VB", 0x0450, 128, 1024, 131072),

        // ===== STM32L0 =====
        new("STM32L0", "STM32L011F4", 0x0457, 16, 2, 128),
        new("STM32L0", "STM32L052K8", 0x0417, 64, 8, 128),
        new("STM32L0", "STM32L073RZ", 0x0447, 192, 20, 128),

        // ===== STM32L4 =====
        new("STM32L4", "STM32L432KC", 0x0462, 256, 64, 2048),
        new("STM32L4", "STM32L476RG", 0x0415, 1024, 128, 2048),

        // ===== STM32WB =====
        new("STM32WB", "STM32WB55CG", 0x0495, 1024, 256, 4096),
    ]
}

fn new(family: &str, name: &str, device_id: u16, flash_kb: u32, ram_kb: u32, page_size: u32) -> Stm32ChipInfo {
    Stm32ChipInfo {
        family: family.to_string(),
        name: name.to_string(),
        device_id,
        flash_kb,
        flash_start: 0x0800_0000,
        ram_kb,
        page_size,
    }
}

pub fn find_chip_by_device_id(device_id: u16) -> Option<Stm32ChipInfo> {
    chip_database()
        .into_iter()
        .find(|c| c.device_id == device_id)
}

pub fn find_chip_by_name(name: &str) -> Option<Stm32ChipInfo> {
    chip_database().into_iter().find(|c| c.name.eq_ignore_ascii_case(name))
}
