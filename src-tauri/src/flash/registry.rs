//! The flashing modules the app knows about.

use super::avr_chips;
use super::chips;
use super::module_trait::{ChipSelection, FlashModule, ModuleAvailability, ModuleChip, ModuleDescriptor};
use super::orchestrator::{EnvStatus, HelpLink};
use super::stc89;
use crate::tools::checker::ToolChecker;

pub const STM32_ISP: &str = "stm32-isp";
pub const ARDUINO_AVR: &str = "arduino-avr";
pub const STC89: &str = "stc89-stcgal";
pub const ESP32: &str = "esp32-esptool";

pub fn modules() -> Vec<Box<dyn FlashModule>> {
    vec![Box::new(Stm32Isp), Box::new(ArduinoAvr), Box::new(Stc89Stcgal), Box::new(Esp32Planned)]
}

pub fn find(id: &str) -> Option<Box<dyn FlashModule>> {
    modules().into_iter().find(|m| m.descriptor().id == id)
}

fn link(label: &str, url: &str) -> HelpLink {
    HelpLink { label: label.into(), url: url.into() }
}

fn ready(version: Option<String>, messages: Vec<String>, references: Vec<HelpLink>) -> EnvStatus {
    EnvStatus {
        ready: true,
        missing_tools: vec![],
        messages,
        version,
        install_hint: None,
        install_steps: vec![],
        references,
    }
}

/* ---------------- STM32 ---------------- */

struct Stm32Isp;

impl FlashModule for Stm32Isp {
    fn descriptor(&self) -> ModuleDescriptor {
        ModuleDescriptor {
            id: STM32_ISP,
            name: "STM32 Serial ISP",
            description: "Flash STM32 MCUs over the built-in serial bootloader.",
            builtin: true,
            availability: ModuleAvailability::Available,
            chip_selection: ChipSelection::Detect,
            chips: chips::chip_database()
                .into_iter()
                .map(|c| ModuleChip {
                    id: c.name.clone(),
                    name: c.name,
                    flash_kb: c.flash_kb,
                    ram_kb: c.ram_kb as f32,
                    flash_start: c.flash_start,
                    page_size: c.page_size,
                })
                .collect(),
            formats: vec!["hex", "ihx", "bin"],
            required_tools: vec![],
        }
    }

    fn check_environment(&self) -> EnvStatus {
        ready(
            Some("built-in".into()),
            vec!["Uses the app's own STM32 serial bootloader implementation. No external tool is needed.".into()],
            vec![link("STM32 USART bootloader protocol (AN3155)", "https://www.st.com/resource/en/application_note/an3155-usart-protocol-used-in-the-stm32-bootloader-stmicroelectronics.pdf")],
        )
    }
}

/* ---------------- AVR ---------------- */

struct ArduinoAvr;

impl FlashModule for ArduinoAvr {
    fn descriptor(&self) -> ModuleDescriptor {
        ModuleDescriptor {
            id: ARDUINO_AVR,
            name: "Arduino AVR (avrdude)",
            description: "Flash Arduino and other AVR boards through avrdude.",
            builtin: true,
            availability: ModuleAvailability::Available,
            chip_selection: ChipSelection::Manual,
            chips: avr_chips::avr_chip_database()
                .into_iter()
                .map(|c| ModuleChip {
                    id: c.avrdude_part,
                    name: c.name,
                    flash_kb: c.flash_kb,
                    ram_kb: c.ram_kb as f32,
                    flash_start: c.flash_start,
                    page_size: c.page_size,
                })
                .collect(),
            formats: vec!["hex", "ihx", "bin"],
            required_tools: vec!["avrdude"],
        }
    }

    fn check_environment(&self) -> EnvStatus {
        let refs = vec![
            link("AVRDUDE releases", "https://github.com/avrdudes/avrdude/releases"),
            link("AVRDUDE documentation", "https://avrdudes.github.io/avrdude/"),
        ];
        if !ToolChecker::is_installed("avrdude") {
            return EnvStatus {
                ready: false,
                missing_tools: vec!["avrdude".into()],
                messages: vec!["avrdude was not found in PATH.".into()],
                version: None,
                install_hint: Some("Install avrdude and add the folder that contains avrdude.exe to PATH.".into()),
                install_steps: vec![
                    "Download the Windows zip from the AVRDUDE releases page and unpack it.".into(),
                    "Add the folder that contains avrdude.exe to PATH.".into(),
                    "Restart Serial Helper and check again.".into(),
                ],
                references: refs,
            };
        }
        let version = ToolChecker::get_version("avrdude", "-?")
            .and_then(|out| out.lines().find(|l| l.contains("version")).map(|l| l.trim().to_string()));
        ready(version, vec!["avrdude found in PATH.".into()], refs)
    }
}

/* ---------------- STC89 ---------------- */

struct Stc89Stcgal;

impl FlashModule for Stc89Stcgal {
    fn descriptor(&self) -> ModuleDescriptor {
        ModuleDescriptor {
            id: STC89,
            name: "STC89/STC90 (stcgal)",
            description: "Flash STC89 and STC90 8051 MCUs through stcgal, with an adjustable power-cycle on DTR or RTS.",
            builtin: true,
            availability: ModuleAvailability::Available,
            chip_selection: ChipSelection::ManualConfirmed,
            chips: stc89::chips(),
            formats: vec!["hex", "ihx", "bin"],
            required_tools: vec!["python", "stcgal"],
        }
    }

    fn check_environment(&self) -> EnvStatus {
        let refs = vec![
            link("stcgal on GitHub", "https://github.com/grigorig/stcgal"),
            link("Python for Windows", "https://www.python.org/downloads/windows/"),
        ];
        match stc89::check_tools() {
            stc89::ToolCheck::NoPython => EnvStatus {
                ready: false,
                missing_tools: vec!["python".into(), "stcgal".into()],
                messages: vec!["No working Python 3 was found (tried python, py -3, python3).".into()],
                version: None,
                install_hint: Some("Install Python 3, then install stcgal with pip.".into()),
                install_steps: vec![
                    "Install Python 3 from python.org and tick \"Add python.exe to PATH\".".into(),
                    "Restart Serial Helper.".into(),
                    "Click \"Install stcgal\" here, or run `python -m pip install stcgal`.".into(),
                ],
                references: refs,
            },
            stc89::ToolCheck::NoStcgal { python, detail } => EnvStatus {
                ready: false,
                missing_tools: vec!["stcgal".into()],
                messages: vec![format!("Python found ({}), but stcgal is not installed.", python.display()), detail],
                version: None,
                install_hint: Some("Install stcgal with pip.".into()),
                install_steps: vec![
                    "Click \"Install stcgal\" here, or run `python -m pip install stcgal` in a terminal.".into(),
                    "Check again when it finishes.".into(),
                ],
                references: refs,
            },
            stc89::ToolCheck::Ready { python, version } => ready(
                Some(version),
                vec![
                    format!("Runs stcgal with {}.", python.display()),
                    "Serial Helper cycles the board's power itself, so the off time and pin level can be set on the flash page.".into(),
                ],
                refs,
            ),
        }
    }
}

/* ---------------- ESP32 (planned) ---------------- */

struct Esp32Planned;

impl FlashModule for Esp32Planned {
    fn descriptor(&self) -> ModuleDescriptor {
        ModuleDescriptor {
            id: ESP32,
            name: "ESP32 (esptool)",
            description: "Planned: UART flashing for ESP32-family chips through esptool.",
            builtin: false,
            availability: ModuleAvailability::Planned,
            chip_selection: ChipSelection::Detect,
            chips: vec![],
            formats: vec!["bin"],
            required_tools: vec!["python", "esptool"],
        }
    }

    fn check_environment(&self) -> EnvStatus {
        EnvStatus {
            ready: false,
            missing_tools: vec![],
            messages: vec!["ESP32 flashing is not implemented yet.".into()],
            version: None,
            install_hint: None,
            install_steps: vec![],
            references: vec![link("esptool documentation", "https://docs.espressif.com/projects/esptool/en/latest/")],
        }
    }
}
