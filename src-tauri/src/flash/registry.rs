use std::sync::Arc;

use super::module_trait::FlashModule;

pub struct ModuleRegistry {
    modules: Vec<Arc<dyn FlashModule>>,
}

impl ModuleRegistry {
    pub fn new() -> Self {
        Self {
            modules: Vec::new(),
        }
    }

    pub fn register(&mut self, module: Arc<dyn FlashModule>) {
        self.modules.push(module);
    }

    pub fn list_all(&self) -> Vec<ModuleDescriptor> {
        self.modules
            .iter()
            .map(|m| ModuleDescriptor {
                id: m.module_id().to_string(),
                name: m.display_name().to_string(),
                description: m.description().to_string(),
                builtin: true,
                chip_count: m.supported_chips().len() as u32,
                format_count: m.supported_formats().len() as u32,
            })
            .collect()
    }

    pub fn find_for_chip(&self, _chip_family: &str) -> Option<&Arc<dyn FlashModule>> {
        // Simple first-match for now
        self.modules.first()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModuleDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub chip_count: u32,
    pub format_count: u32,
}
