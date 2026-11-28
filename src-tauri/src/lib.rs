mod commands;
mod error;
mod firmware;
mod flash;
mod serial;
mod state;
mod tools;

use state::AppState;
use tauri::Manager;

#[cfg(windows)]
fn migrate_legacy_data(destination: &std::path::Path) -> std::io::Result<()> {
    let legacy = destination.with_file_name("com.serial-helper.app");
    if !destination.try_exists()? && legacy.is_dir() {
        std::fs::rename(legacy, destination)?;
    }
    Ok(())
}

pub fn run() {
    env_logger::init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            // The window starts hidden and the page shows it after its first
            // paint. If the page fails to load, show it anyway.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(win) = handle.get_webview_window("main") {
                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                    }
                }
            });
            Ok(())
        })
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
            commands::serial_cmd::save_text_file,
            commands::flash_cmd::parse_firmware,
            commands::flash_cmd::parse_firmware_cached,
            commands::flash_cmd::read_chip_info,
            commands::flash_cmd::erase_chip,
            commands::flash_cmd::read_flash,
            commands::flash_cmd::cancel_flash,
            commands::module_cmd::list_modules,
            commands::module_cmd::check_module_env,
            commands::module_cmd::install_module_tools,
            commands::module_cmd::module_flash,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Serial Helper");

    // Tauri opens the WebView profile when the event loop starts.
    #[cfg(windows)]
    match app.path().app_local_data_dir() {
        Ok(destination) => {
            if let Err(error) = migrate_legacy_data(&destination) {
                log::warn!("Cannot migrate Serial Helper data to {}: {error}", destination.display());
            }
        }
        Err(error) => log::warn!("Cannot locate the Serial Helper data directory: {error}"),
    }

    app.run(|_, _| {});
}

#[cfg(all(test, windows))]
mod tests {
    use super::migrate_legacy_data;
    use std::fs;

    #[test]
    fn migrates_the_old_profile_and_tools_once() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("serial-helper");
        let legacy = root.path().join("com.serial-helper.app");

        migrate_legacy_data(&destination).unwrap();
        assert!(!destination.exists());

        fs::create_dir_all(legacy.join("EBWebView")).unwrap();
        fs::create_dir_all(legacy.join("tools")).unwrap();
        migrate_legacy_data(&destination).unwrap();
        assert!(destination.join("EBWebView").is_dir());
        assert!(destination.join("tools").is_dir());
        assert!(!legacy.exists());

        fs::create_dir(&legacy).unwrap();
        migrate_legacy_data(&destination).unwrap();
        assert!(legacy.is_dir());
        assert!(destination.join("tools").is_dir());
    }
}
