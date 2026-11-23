import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

const cargo = fs.readFileSync(cargoPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${version}"`
);
fs.writeFileSync(cargoPath, cargo, "utf8");

// Keep Cargo.lock's entry for this crate in step, so a bump commits cleanly.
const lockPath = path.join(root, "src-tauri", "Cargo.lock");
if (fs.existsSync(lockPath)) {
  const lock = fs.readFileSync(lockPath, "utf8").replace(
    /(\[\[package\]\]\r?\nname = "serial-helper"\r?\nversion = )".*"/,
    `$1"${version}"`
  );
  fs.writeFileSync(lockPath, lock, "utf8");
}

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = version;
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8");

console.log(`Synchronized version ${version} to Cargo.toml, Cargo.lock and tauri.conf.json`);
