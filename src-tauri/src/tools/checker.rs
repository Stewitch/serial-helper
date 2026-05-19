use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct ToolChecker;

impl ToolChecker {
    #[cfg(target_os = "windows")]
    fn hidden_command(program: &str) -> Command {
        let mut command = Command::new(program);
        command.creation_flags(0x08000000);
        command
    }

    #[cfg(not(target_os = "windows"))]
    fn hidden_command(program: &str) -> Command {
        Command::new(program)
    }

    pub fn is_installed(command: &str) -> bool {
        let output = if cfg!(target_os = "windows") {
            Self::hidden_command("where").arg(command).output()
        } else {
            Self::hidden_command("which").arg(command).output()
        };

        output
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn get_version(command: &str, version_arg: &str) -> Option<String> {
        let output = Self::hidden_command(command)
            .arg(version_arg)
            .output()
            .ok()?;

        let stdout = String::from_utf8(output.stdout).ok().unwrap_or_default();
        let stderr = String::from_utf8(output.stderr).ok().unwrap_or_default();
        let merged = if stdout.trim().is_empty() { stderr } else { stdout };
        let text = merged.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }
}
