use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvrChipInfo {
    pub family: String,
    pub name: String,
    pub avrdude_part: String,
    pub signature: [u8; 3],
    pub flash_kb: u32,
    pub ram_kb: u32,
    pub eeprom_kb: u32,
    pub flash_start: u32,
    pub page_size: u32,
}

pub fn avr_chip_database() -> Vec<AvrChipInfo> {
    vec![
        // ── ATmega328 family ──
        AvrChipInfo {
            family: "ATmega328".into(),
            name: "ATmega328P".into(),
            avrdude_part: "m328p".into(),
            signature: [0x1E, 0x95, 0x0F],
            flash_kb: 32,
            ram_kb: 2,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 128,
        },
        AvrChipInfo {
            family: "ATmega328".into(),
            name: "ATmega328".into(),
            avrdude_part: "m328".into(),
            signature: [0x1E, 0x95, 0x14],
            flash_kb: 32,
            ram_kb: 2,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 128,
        },
        // ── ATmega2560 ──
        AvrChipInfo {
            family: "ATmega2560".into(),
            name: "ATmega2560".into(),
            avrdude_part: "m2560".into(),
            signature: [0x1E, 0x98, 0x01],
            flash_kb: 256,
            ram_kb: 8,
            eeprom_kb: 4,
            flash_start: 0,
            page_size: 256,
        },
        // ── ATmega32U4 ──
        AvrChipInfo {
            family: "ATmega32U4".into(),
            name: "ATmega32U4".into(),
            avrdude_part: "m32u4".into(),
            signature: [0x1E, 0x95, 0x87],
            flash_kb: 32,
            ram_kb: 2,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 128,
        },
        // ── ATmega168 ──
        AvrChipInfo {
            family: "ATmega168".into(),
            name: "ATmega168P".into(),
            avrdude_part: "m168p".into(),
            signature: [0x1E, 0x94, 0x0B],
            flash_kb: 16,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 128,
        },
        AvrChipInfo {
            family: "ATmega168".into(),
            name: "ATmega168".into(),
            avrdude_part: "m168".into(),
            signature: [0x1E, 0x94, 0x06],
            flash_kb: 16,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 128,
        },
        // ── ATmega88 ──
        AvrChipInfo {
            family: "ATmega88".into(),
            name: "ATmega88P".into(),
            avrdude_part: "m88p".into(),
            signature: [0x1E, 0x93, 0x0F],
            flash_kb: 8,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 64,
        },
        // ── ATmega644 ──
        AvrChipInfo {
            family: "ATmega644".into(),
            name: "ATmega644P".into(),
            avrdude_part: "m644p".into(),
            signature: [0x1E, 0x96, 0x0A],
            flash_kb: 64,
            ram_kb: 4,
            eeprom_kb: 2,
            flash_start: 0,
            page_size: 256,
        },
        // ── ATmega1284P ──
        AvrChipInfo {
            family: "ATmega1284".into(),
            name: "ATmega1284P".into(),
            avrdude_part: "m1284p".into(),
            signature: [0x1E, 0x97, 0x06],
            flash_kb: 128,
            ram_kb: 16,
            eeprom_kb: 4,
            flash_start: 0,
            page_size: 256,
        },
        // ── ATtiny85 ──
        AvrChipInfo {
            family: "ATtiny85".into(),
            name: "ATtiny85".into(),
            avrdude_part: "t85".into(),
            signature: [0x1E, 0x93, 0x0B],
            flash_kb: 8,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 64,
        },
        // ── ATtiny84 ──
        AvrChipInfo {
            family: "ATtiny84".into(),
            name: "ATtiny84".into(),
            avrdude_part: "t84".into(),
            signature: [0x1E, 0x93, 0x0C],
            flash_kb: 8,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 64,
        },
        // ── ATmega8 ──
        AvrChipInfo {
            family: "ATmega8".into(),
            name: "ATmega8".into(),
            avrdude_part: "m8".into(),
            signature: [0x1E, 0x93, 0x07],
            flash_kb: 8,
            ram_kb: 1,
            eeprom_kb: 1,
            flash_start: 0,
            page_size: 64,
        },
    ]
}

pub fn find_avr_chip_by_name(name: &str) -> Option<AvrChipInfo> {
    avr_chip_database()
        .into_iter()
        .find(|c| c.name.eq_ignore_ascii_case(name) || c.avrdude_part.eq_ignore_ascii_case(name))
}

pub fn find_avr_chip_by_signature(sig: &[u8; 3]) -> Option<AvrChipInfo> {
    avr_chip_database()
        .into_iter()
        .find(|c| &c.signature == sig)
}
