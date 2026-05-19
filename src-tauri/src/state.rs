use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use crate::firmware::FirmwareData;
use crate::serial::manager::SerialManager;

#[derive(Clone)]
pub struct FirmwareCacheEntry {
    pub size: u64,
    pub modified_ms: u128,
    pub firmware: FirmwareData,
}

pub struct AppState {
    pub serial_manager: Arc<RwLock<SerialManager>>,
    pub parsed_firmware_cache: Arc<RwLock<HashMap<String, FirmwareCacheEntry>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            serial_manager: Arc::new(RwLock::new(SerialManager::new())),
            parsed_firmware_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}
