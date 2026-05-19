mod commands;
mod error;
mod firmware;
mod flash;
mod serial;
mod state;
mod tools;

use state::AppState;

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::serial_cmd::list_ports,
            commands::serial_cmd::open_port,
            commands::serial_cmd::close_port,
            commands::serial_cmd::write_data,
            commands::serial_cmd::read_data,
            commands::serial_cmd::serial_is_open,
            commands::serial_cmd::serial_active_port,
            commands::serial_cmd::serial_set_dtr,
            commands::serial_cmd::serial_set_rts,
            commands::flash_cmd::parse_firmware,
            commands::flash_cmd::parse_firmware_cached,
            commands::flash_cmd::read_chip_info,
            commands::flash_cmd::erase_chip,
            commands::flash_cmd::read_flash,
            commands::flash_cmd::start_flash,
            commands::flash_cmd::cancel_flash,
            commands::module_cmd::list_modules,
            commands::module_cmd::check_module_env,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SerialHelper");
}
