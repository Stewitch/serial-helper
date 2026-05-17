use parking_lot::RwLock;
use std::sync::Arc;

use crate::serial::manager::SerialManager;

pub struct AppState {
    pub serial_manager: Arc<RwLock<SerialManager>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            serial_manager: Arc::new(RwLock::new(SerialManager::new())),
        }
    }
}
