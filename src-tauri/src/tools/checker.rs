use std::process::Command;

pub struct ToolChecker;

impl ToolChecker {
    pub fn is_installed(command: &str) -> bool {
        let check_cmd = if cfg!(target_os = "windows") {
            format!("where {}", command)
        } else {
            format!("which {}", command)
        };

        Command::new(if cfg!(target_os = "windows") { "cmd" } else { "sh" })
            .arg(if cfg!(target_os = "windows") {
                "/C"
            } else {
                "-c"
            })
            .arg(&check_cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn get_version(command: &str, version_arg: &str) -> Option<String> {
        Command::new(command)
            .arg(version_arg)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    }
}
