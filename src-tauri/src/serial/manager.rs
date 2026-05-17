use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serialport::SerialPort;

use crate::error::{AppError, AppResult};
use crate::serial::config::SerialConfig;

pub struct SerialManager {
    port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
}

impl SerialManager {
    pub fn new() -> Self {
        Self {
            port: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_open(&self) -> bool {
        self.port.lock().is_some()
    }

    pub fn active_port_name(&self) -> Option<String> {
        self.port.lock().as_ref().and_then(|p| p.name())
    }

    pub fn open(&self, config: &SerialConfig) -> AppResult<()> {
        let mut port_guard = self.port.lock();
        if port_guard.is_some() {
            return Err(AppError::PortInUse(config.port_name.clone()));
        }

        let port = serialport::new(&config.port_name, config.baud_rate)
            .data_bits(config.data_bits.clone().into())
            .stop_bits(config.stop_bits.clone().into())
            .parity(config.parity.clone().into())
            .flow_control(config.flow_control.clone().into())
            .timeout(Duration::from_millis(10))
            .open()?;

        *port_guard = Some(port);
        Ok(())
    }

    pub fn close(&self) -> AppResult<()> {
        let mut port_guard = self.port.lock();
        *port_guard = None;
        Ok(())
    }

    pub fn write(&self, data: &[u8]) -> AppResult<usize> {
        let mut port_guard = self.port.lock();
        let port = port_guard
            .as_mut()
            .ok_or(AppError::PortNotOpen)?;

        let written = port.write(data)?;
        port.flush()?;
        Ok(written)
    }

    pub fn read_available(&self) -> AppResult<Vec<u8>> {
        let mut port_guard = self.port.lock();
        let port = port_guard
            .as_mut()
            .ok_or(AppError::PortNotOpen)?;

        let available = port.bytes_to_read().unwrap_or(0) as usize;
        if available == 0 {
            return Ok(Vec::new());
        }

        let to_read = available.min(8192);
        let mut buf = vec![0u8; to_read];
        let n = port.read(&mut buf)?;
        buf.truncate(n);
        Ok(buf)
    }

    pub fn set_dtr(&self, state: bool) -> AppResult<()> {
        let mut port_guard = self.port.lock();
        let port = port_guard
            .as_mut()
            .ok_or(AppError::PortNotOpen)?;
        port.write_data_terminal_ready(state)?;
        Ok(())
    }

    pub fn set_rts(&self, state: bool) -> AppResult<()> {
        let mut port_guard = self.port.lock();
        let port = port_guard
            .as_mut()
            .ok_or(AppError::PortNotOpen)?;
        port.write_request_to_send(state)?;
        Ok(())
    }
}
