#![allow(unused_variables)]

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::orchestrator::{
    ChipInfo, EnvStatus, FirmwareFormat, FlashProgress, ToolDependency,
};
use crate::error::AppResult;

#[async_trait]
pub trait FlashModule: Send + Sync {
    fn module_id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn supported_chips(&self) -> &[ChipInfo];
    fn supported_formats(&self) -> &[FirmwareFormat];
    fn tool_dependencies(&self) -> &[ToolDependency];

    async fn check_environment(&self) -> AppResult<EnvStatus>;

    async fn flash(
        &self,
        chip: &ChipInfo,
        firmware: &[u8],
        format: &FirmwareFormat,
        progress: mpsc::Sender<FlashProgress>,
    ) -> AppResult<()>;

    async fn cancel(&self) -> AppResult<()>;
}
