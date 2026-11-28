use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy)]
pub enum ManagedTool {
    Avrdude,
    Stc89,
}

impl ManagedTool {
    pub fn supported() -> bool {
        cfg!(all(windows, target_arch = "x86_64"))
    }

    fn package(self) -> (&'static str, &'static str) {
        match self {
            Self::Avrdude => ("avrdude", "8.1"),
            Self::Stc89 => ("stc89", "python-3.14.5-stcgal-1.10"),
        }
    }

    pub fn path(self, tools_dir: &Path) -> PathBuf {
        let (name, version) = self.package();
        tools_dir.join(name).join(version)
    }

    pub fn install(
        self,
        tools_dir: &Path,
        validate: impl Fn(&Path) -> AppResult<()>,
        on_line: impl FnMut(&str),
    ) -> AppResult<()> {
        #[cfg(all(windows, target_arch = "x86_64"))]
        {
            windows::install(self, tools_dir, validate, on_line)
        }
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        {
            let _ = (tools_dir, validate, on_line);
            Err(AppError::Generic(
                "Automatic tool installation requires Windows x64".into(),
            ))
        }
    }
}

pub fn tools_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("tools"))
        .map_err(|error| {
            AppError::Generic(format!(
                "Cannot find the application's local data directory: {error}"
            ))
        })
}

#[cfg(all(windows, target_arch = "x86_64"))]
mod windows {
    use std::fs::{self, File, OpenOptions, TryLockError};
    use std::io::{self, BufReader, Read, Write};
    use std::time::Duration;

    use reqwest::blocking::Client;
    use sha2::{Digest, Sha256};
    use zip::ZipArchive;

    use super::*;

    const MAX_DOWNLOAD_BYTES: u64 = 32 * 1024 * 1024;
    const MAX_EXTRACTED_BYTES: u64 = 128 * 1024 * 1024;

    struct Archive {
        name: &'static str,
        url: &'static str,
        sha256: &'static str,
    }

    const AVRDUDE: Archive = Archive {
        name: "AVRDUDE 8.1",
        url: "https://github.com/avrdudes/avrdude/releases/download/v8.1/avrdude-v8.1-windows-mingw-x64.zip",
        sha256: "46e2474a045bde824a7ff05eaee2f9a6e5cca711fd731526b4198d05a44103c5",
    };

    const PYTHON: Archive = Archive {
        name: "Python 3.14.5",
        url: "https://www.python.org/ftp/python/3.14.5/python-3.14.5-embed-amd64.zip",
        sha256: "ba6bd811c4eedb19195cf275770ef127e893d63701e24152606e2cb76f6d876a",
    };

    const STC89_WHEELS: &[Archive] = &[
        Archive {
            name: "stcgal 1.10",
            url: "https://files.pythonhosted.org/packages/7c/43/41d3110526c952b6b5602cff4d99860d443c5ad4d345f8c39b7aad595e1c/stcgal-1.10-py3-none-any.whl",
            sha256: "047aea6dd99003bc58064dfbb95a3b002e39227ca77da62191f11889468094e7",
        },
        Archive {
            name: "pyserial 3.5",
            url: "https://files.pythonhosted.org/packages/07/bc/587a445451b253b285629263eb51c2d8e9bcea4fc97826266d186f96f558/pyserial-3.5-py2.py3-none-any.whl",
            sha256: "c4451db6ba391ca6ca299fb3ec7bae67a5c55dde170964c7a14ceefec02f2cf0",
        },
        Archive {
            name: "tqdm 4.67.1",
            url: "https://files.pythonhosted.org/packages/d0/30/dc54f88dd4a2b5dc8a0279bdd7270e735851848b762aeb1c1184ed1f6b14/tqdm-4.67.1-py3-none-any.whl",
            sha256: "26445eca388f82e72884e0d580d5464cd801a3ea01e63e5601bdff9ba6a48de2",
        },
        Archive {
            name: "colorama 0.4.6",
            url: "https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl",
            sha256: "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
        },
    ];

    pub(super) fn install(
        tool: ManagedTool,
        tools_dir: &Path,
        validate: impl Fn(&Path) -> AppResult<()>,
        mut on_line: impl FnMut(&str),
    ) -> AppResult<()> {
        let root = tools_dir.join(tool.package().0);
        fs::create_dir_all(&root).map_err(|error| stage_error("Create tool directory", error))?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("install.lock"))
            .map_err(|error| stage_error("Open install lock", error))?;
        lock.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => {
                AppError::Generic("This tool is already being installed".into())
            }
            TryLockError::Error(error) => stage_error("Lock tool installation", error),
        })?;

        let destination = tool.path(tools_dir);
        if destination.is_dir() && validate(&destination).is_ok() {
            return Ok(());
        }

        let staging = tempfile::Builder::new()
            .prefix(".install-")
            .tempdir_in(root)
            .map_err(|error| stage_error("Create temporary install directory", error))?;
        let runtime = staging.path().join("runtime");
        let client = Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .user_agent(concat!("Serial Helper/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| stage_error("Set up download connection", error))?;

        match tool {
            ManagedTool::Avrdude => install_archive(&client, &AVRDUDE, &runtime, &mut on_line)?,
            ManagedTool::Stc89 => {
                install_archive(&client, &PYTHON, &runtime, &mut on_line)?;
                let packages = runtime.join("packages");
                // The embeddable Python uses this file to define its entire import path.
                fs::write(
                    runtime.join("python314._pth"),
                    "python314.zip\r\n.\r\npackages\r\n",
                )
                .map_err(|error| stage_error("Configure Python import paths", error))?;
                for wheel in STC89_WHEELS {
                    install_archive(&client, wheel, &packages, &mut on_line)?;
                }
            }
        }

        on_line("Verifying installed tools...");
        validate(&runtime)?;

        // Replacing a damaged installation is safe only after the new copy passes its probe.
        let backup = staging.path().join("previous");
        let has_previous = destination.exists();
        if has_previous {
            fs::rename(&destination, &backup)
                .map_err(|error| stage_error("Move previous installation", error))?;
        }
        if let Err(error) = fs::rename(&runtime, &destination) {
            if has_previous {
                if let Err(restore_error) = fs::rename(&backup, &destination) {
                    let recovery = staging.keep().join("previous");
                    return Err(stage_error(
                        "Restore previous installation",
                        format!(
                            "{restore_error}. Previous files are at {}",
                            recovery.display()
                        ),
                    ));
                }
            }
            return Err(stage_error("Activate verified installation", error));
        }
        on_line(&format!("Installed to {}", destination.display()));
        Ok(())
    }

    fn install_archive(
        client: &Client,
        archive: &Archive,
        destination: &Path,
        on_line: &mut impl FnMut(&str),
    ) -> AppResult<()> {
        fs::create_dir_all(destination)
            .map_err(|error| stage_error("Create extraction directory", error))?;
        on_line(&format!("Downloading {}…", archive.name));
        let mut response = client
            .get(archive.url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| {
                let mut detail = error.to_string();
                let mut cause = std::error::Error::source(&error);
                while let Some(error) = cause {
                    detail.push_str(&format!(": {error}"));
                    cause = error.source();
                }
                stage_error(archive.name, detail)
            })?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_DOWNLOAD_BYTES)
        {
            return Err(stage_error(archive.name, "download exceeds the size limit"));
        }
        let mut file = tempfile::tempfile_in(destination)
            .map_err(|error| stage_error("Create temporary download", error))?;
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            let n = response
                .read(&mut buffer)
                .map_err(|error| stage_error(archive.name, error))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_DOWNLOAD_BYTES {
                return Err(stage_error(archive.name, "download exceeds the size limit"));
            }
            digest.update(&buffer[..n]);
            file.write_all(&buffer[..n])
                .map_err(|error| stage_error("Write temporary download", error))?;
        }
        on_line(&format!("Checking SHA-256 for {}…", archive.name));
        if hex::encode(digest.finalize()) != archive.sha256 {
            return Err(stage_error(archive.name, "SHA-256 mismatch"));
        }
        on_line(&format!("Extracting {}…", archive.name));
        extract(file, destination).map_err(|error| stage_error(archive.name, error))
    }

    fn extract(file: File, destination: &Path) -> io::Result<()> {
        let mut zip = ZipArchive::new(BufReader::new(file))?;
        let mut remaining = MAX_EXTRACTED_BYTES;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| io::Error::other("Invalid archive path"))?;
            if !relative
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)))
                || relative.as_os_str().to_string_lossy().contains(':')
                || (!entry.is_dir() && !entry.is_file())
            {
                return Err(io::Error::other("Unsupported archive entry"));
            }
            let target = destination.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(target)?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut output = File::create_new(target)?;
                let copied = io::copy(&mut (&mut entry).take(remaining + 1), &mut output)?;
                remaining = remaining
                    .checked_sub(copied)
                    .ok_or_else(|| io::Error::other("Extracted files exceed the size limit"))?;
            }
        }
        Ok(())
    }

    fn stage_error(stage: &str, error: impl std::fmt::Display) -> AppError {
        AppError::Generic(format!("{stage}: {error}"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::flash::orchestrator::ToolSource;
        use crate::flash::{arduino_avr, stc89};

        #[test]
        fn extraction_rejects_paths_outside_the_staging_directory() {
            let staging = tempfile::tempdir().unwrap();
            let mut zip = zip::ZipWriter::new(tempfile::tempfile().unwrap());
            zip.start_file("../outside.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"outside").unwrap();
            assert!(extract(zip.finish().unwrap(), &staging.path().join("runtime")).is_err());
            assert!(!staging.path().join("outside.txt").exists());
        }

        #[test]
        #[ignore = "downloads the pinned Windows tool archives"]
        fn installs_and_resolves_the_upstream_packages() {
            let root = tempfile::Builder::new()
                .prefix("Serial Helper 依赖 ")
                .tempdir()
                .unwrap();
            let path = root.path();
            let log = |line: &str| println!("{line}");

            let failed_validation = ManagedTool::Avrdude.install(
                path,
                |_| Err(AppError::Generic("test validation failure".into())),
                log,
            );
            assert!(
                matches!(&failed_validation, Err(AppError::Generic(message)) if message == "test validation failure"),
                "{failed_validation:?}"
            );
            assert!(!ManagedTool::Avrdude.path(path).exists());
            ManagedTool::Avrdude
                .install(path, arduino_avr::validate_runtime, log)
                .unwrap();
            ManagedTool::Avrdude
                .install(path, arduino_avr::validate_runtime, |_| {
                    panic!("tool already installed")
                })
                .unwrap();
            let (_, avr_version, avr_source) = arduino_avr::resolve_tool(path).unwrap();
            assert!(avr_version.contains("8.1"));
            assert!(matches!(avr_source, ToolSource::Managed));

            ManagedTool::Stc89
                .install(path, stc89::validate_runtime, log)
                .unwrap();
            match stc89::check_tools(path) {
                stc89::ToolCheck::Ready {
                    version,
                    source: ToolSource::Managed,
                    ..
                } => {
                    assert!(version.contains("stcgal 1.10"));
                    assert!(version.contains("Python 3.14.5"));
                }
                _ => panic!("expected to resolve the installed STC89 runtime"),
            }
        }
    }
}
