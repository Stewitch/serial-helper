use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::flash::orchestrator::{EnvStatus, HelpLink};
use crate::tools::checker::ToolChecker;

#[derive(Debug, Clone, Serialize)]
pub struct ModuleInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub installed: bool,
    pub chip_count: u32,
    pub format_count: u32,
    pub status: String,
    pub required_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleEnvUpdate {
    pub module: ModuleInfo,
    pub env: EnvStatus,
}

fn module_catalog() -> Vec<ModuleInfo> {
    let avrdude_ready = ToolChecker::is_installed("avrdude");

    vec![
        ModuleInfo {
            id: "stm32-isp".into(),
            name: "STM32 Serial ISP".into(),
            description: "Flash STM32 MCUs over the built-in serial bootloader.".into(),
            builtin: true,
            installed: true,
            chip_count: 48,
            format_count: 2,
            status: "ready".into(),
            required_tools: vec![],
        },
        ModuleInfo {
            id: "arduino-avr".into(),
            name: "Arduino AVR".into(),
            description: "Flash Arduino AVR boards through avrdude.".into(),
            builtin: true,
            installed: avrdude_ready,
            chip_count: 12,
            format_count: 1,
            status: if avrdude_ready { "ready" } else { "missing-tools" }.into(),
            required_tools: vec!["avrdude".into()],
        },
        ModuleInfo {
            id: "esp32-esptool".into(),
            name: "ESP32 (esptool)".into(),
            description: "Planned UART flashing support for ESP32-family chips.".into(),
            builtin: false,
            installed: false,
            chip_count: 0,
            format_count: 0,
            status: "planned".into(),
            required_tools: vec!["python".into(), "esptool".into()],
        },
    ]
}

#[tauri::command]
pub fn list_modules() -> Result<Vec<ModuleInfo>, String> {
    Ok(module_catalog())
}

#[tauri::command]
pub fn check_module_env(module_id: String) -> Result<EnvStatus, String> {
    match module_id.as_str() {
        "stm32-isp" => Ok(EnvStatus {
            ready: true,
            missing_tools: vec![],
            messages: vec![
                "Uses the built-in STM32 serial ISP implementation.".into(),
                "No external tool is required.".into(),
            ],
            version: Some("Built-in".into()),
            install_hint: None,
            install_steps: vec![],
            references: vec![],
        }),
        "arduino-avr" => {
            let ready = ToolChecker::is_installed("avrdude");
            let version = ToolChecker::get_version("avrdude", "-?");
            let messages = if let Some(ref version_text) = version {
                vec![format!(
                    "avrdude detected: {}",
                    version_text.lines().next().unwrap_or("available")
                )]
            } else if ready {
                vec!["avrdude detected.".into()]
            } else {
                vec!["avrdude was not found in PATH.".into()]
            };

            Ok(EnvStatus {
                ready,
                missing_tools: if ready { vec![] } else { vec!["avrdude".into()] },
                messages,
                version,
                install_hint: if ready {
                    None
                } else {
                    Some("Install avrdude and make sure the executable is available in PATH.".into())
                },
                install_steps: if ready {
                    vec![]
                } else {
                    vec![
                        "Download a Windows build of avrdude or install it with a package manager you already use.".into(),
                        "Make sure the folder containing avrdude.exe is added to PATH.".into(),
                        "Open a new terminal and run `avrdude -?` to confirm it is available.".into(),
                    ]
                },
                references: vec![HelpLink {
                    label: "AVRDUDE documentation".into(),
                    url: "https://avrdudes.github.io/avrdude/8.0/avrdude_toc.html".into(),
                }],
            })
        }
        "esp32-esptool" => {
            let python_ready = ToolChecker::is_installed("python");
            let esptool_ready = ToolChecker::is_installed("esptool");
            let mut missing = Vec::new();
            if !python_ready {
                missing.push("python".into());
            }
            if !esptool_ready {
                missing.push("esptool".into());
            }

            Ok(EnvStatus {
                ready: missing.is_empty(),
                missing_tools: missing,
                messages: vec![
                    "ESP32 support is planned and not wired into flashing yet.".into(),
                    "This check only validates whether Python and esptool are available.".into(),
                ],
                version: ToolChecker::get_version("esptool", "version")
                    .and_then(|output| output.lines().next().map(|line| line.to_string())),
                install_hint: Some("Install Python 3 and `esptool`, then make both available in PATH.".into()),
                install_steps: if python_ready && esptool_ready {
                    vec![]
                } else {
                    vec![
                        "Install Python 3 for Windows and enable the option to add Python to PATH.".into(),
                        "Open a new terminal and run `python -m pip install esptool`.".into(),
                        "Verify the installation with `esptool version`.".into(),
                    ]
                },
                references: vec![
                    HelpLink {
                        label: "esptool installation guide".into(),
                        url: "https://docs.espressif.com/projects/esptool/en/latest/installation.html".into(),
                    },
                    HelpLink {
                        label: "Python for Windows".into(),
                        url: "https://www.python.org/downloads/windows/".into(),
                    },
                ],
            })
        }
        _ => Err(format!("Unknown module '{}'", module_id)),
    }
}

#[tauri::command]
pub fn start_module_scan(app: AppHandle) -> Result<(), String> {
    let modules = module_catalog();
    std::thread::spawn(move || {
        for module in modules {
            if let Ok(env) = check_module_env(module.id.clone()) {
                let _ = app.emit(
                    "module-env-update",
                    ModuleEnvUpdate {
                        module,
                        env,
                    },
                );
            }
        }
    });

    Ok(())
}
