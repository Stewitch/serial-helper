use std::collections::VecDeque;
use std::io::{Read, Write};
use std::time::Duration;
use std::time::Instant;

use serialport::SerialPort;

use crate::error::{AppError, AppResult};

pub struct Stm32Isp {
    port: Box<dyn SerialPort>,
    pending_rx: VecDeque<u8>,
}

const CMD_GET: u8 = 0x00;
const CMD_GET_VERSION: u8 = 0x01;
const CMD_GET_ID: u8 = 0x02;
const CMD_READ_MEMORY: u8 = 0x11;
const CMD_GO: u8 = 0x21;
const CMD_WRITE_MEMORY: u8 = 0x31;
const CMD_ERASE: u8 = 0x43;

const ACK: u8 = 0x79;
const NACK: u8 = 0x1F;
const SYNC_BYTE: u8 = 0x7F;
const DEFAULT_TIMEOUT_MS: u64 = 5000;
const BOOTLOADER_STATUS_BYTES: &[u8] = &[ACK, NACK, 0xFC];

impl Stm32Isp {
    pub fn new(mut port: Box<dyn SerialPort>) -> AppResult<Self> {
        port.set_timeout(Duration::from_secs(3))?;
        Ok(Self {
            port,
            pending_rx: VecDeque::new(),
        })
    }

    fn set_timeout(&mut self, ms: u64) -> AppResult<()> {
        self.port.set_timeout(Duration::from_millis(ms))?;
        Ok(())
    }

    fn sync_response_detected(bytes: &[u8]) -> bool {
        if bytes.contains(&ACK) {
            return true;
        }

        for start in 0..bytes.len() {
            let suffix = &bytes[start..];
            if suffix.len() >= 2 && suffix.iter().all(|b| BOOTLOADER_STATUS_BYTES.contains(b)) {
                return true;
            }
        }

        false
    }

    fn read_byte(&mut self) -> AppResult<u8> {
        if let Some(byte) = self.pending_rx.pop_front() {
            return Ok(byte);
        }

        let mut buf = [0u8; 1];
        self.port.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    fn read_vec(&mut self, len: usize) -> AppResult<Vec<u8>> {
        let mut data = vec![0u8; len];
        let mut offset = 0usize;

        while offset < len {
            if let Some(byte) = self.pending_rx.pop_front() {
                data[offset] = byte;
                offset += 1;
                continue;
            }

            self.port.read_exact(&mut data[offset..])?;
            break;
        }

        Ok(data)
    }

    fn expect_ack(&mut self, context: &str) -> AppResult<()> {
        let byte = self.read_byte()?;
        if byte == ACK {
            Ok(())
        } else {
            Err(AppError::FlashError(format!(
                "{} failed: got {:02x}, expected {:02x}",
                context, byte, ACK
            )))
        }
    }

    fn drain_input(&mut self) -> AppResult<Vec<u8>> {
        self.set_timeout(30)?;

        let mut drained: Vec<u8> = self.pending_rx.drain(..).collect();
        let mut buf = [0u8; 64];
        loop {
            match self.port.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => drained.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }

        self.set_timeout(DEFAULT_TIMEOUT_MS)?;
        Ok(drained)
    }

    fn stash_pending<I>(&mut self, bytes: I)
    where
        I: IntoIterator<Item = u8>,
    {
        self.pending_rx.extend(bytes);
    }

    fn wait_for_quiet(&mut self, quiet_ms: u64, max_wait_ms: u64) -> AppResult<Vec<u8>> {
        let start = Instant::now();
        let quiet = Duration::from_millis(quiet_ms);
        let max_wait = Duration::from_millis(max_wait_ms);
        let mut last_data_at = Instant::now();
        let mut saw_data = false;
        let mut drained = Vec::new();
        let mut buf = [0u8; 64];

        self.set_timeout(10)?;

        loop {
            match self.port.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    drained.extend_from_slice(&buf[..n]);
                    saw_data = true;
                    last_data_at = Instant::now();
                }
                Err(_) => {}
            }

            let now = Instant::now();
            if saw_data && now.duration_since(last_data_at) >= quiet {
                break;
            }
            if now.duration_since(start) >= max_wait {
                break;
            }
        }

        self.set_timeout(DEFAULT_TIMEOUT_MS)?;
        Ok(drained)
    }

    fn send_address(&mut self, address: u32, context: &str) -> AppResult<()> {
        let addr_bytes = address.to_be_bytes();
        let checksum = addr_bytes.iter().fold(0u8, |acc, &b| acc ^ b);

        self.port.write_all(&addr_bytes)?;
        self.port.write_all(&[checksum])?;
        self.port.flush()?;
        self.expect_ack(context)
    }

    /// Enter bootloader: send continuous bursts of 0x7F and watch for
    /// bootloader-only responses. This matches boards that emit stray app bytes
    /// before the ROM responds, and boards that answer repeated syncs with NACKs.
    pub fn enter_bootloader(&mut self, on_bytes: &dyn Fn(&[u8])) -> AppResult<()> {
        let mut all_bytes = Vec::new();
        self.set_timeout(20)?;

        let start = Instant::now();
        let mut last_report = start;

        loop {
            self.port.write_all(&[SYNC_BYTE])?;
            self.port.flush()?;
            let batch = self.wait_for_quiet(20, 180)?;

            if !batch.is_empty() {
                all_bytes.extend_from_slice(&batch);

                if last_report.elapsed() > Duration::from_millis(500) {
                    on_bytes(&all_bytes);
                    last_report = std::time::Instant::now();
                }

                if Self::sync_response_detected(&all_bytes) {
                    self.set_timeout(DEFAULT_TIMEOUT_MS)?;
                    std::thread::sleep(Duration::from_millis(40));
                    let trailing = self.wait_for_quiet(40, 160)?;
                    if !trailing.is_empty() {
                        all_bytes.extend_from_slice(&trailing);
                    }
                    on_bytes(&all_bytes);
                    return Ok(());
                }
            }

            if start.elapsed() > Duration::from_secs(15) {
                break;
            }
        }

        self.set_timeout(DEFAULT_TIMEOUT_MS)?;
        on_bytes(&all_bytes);
        Err(AppError::FlashError(format!(
            "No bootloader after 15s. Saw: {}",
            all_bytes
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" ")
        )))
    }

    fn send_command(&mut self, cmd: u8) -> AppResult<()> {
        for attempt in 0..3 {
            let drained = self.drain_input()?;

            self.port.write_all(&[cmd, !cmd])?;
            self.port.flush()?;

            match self.read_byte() {
                Ok(ACK) => return Ok(()),
                Ok(first) => {
                    let mut response = vec![first];
                    let trailing = self.wait_for_quiet(12, 80)?;
                    response.extend_from_slice(&trailing);

                    if let Some(ack_pos) = response.iter().position(|&byte| byte == ACK) {
                        self.stash_pending(response.iter().skip(ack_pos + 1).copied());
                        return Ok(());
                    }

                    let retryable = response.iter().all(|&byte| byte == NACK || byte == 0xFC);
                    if retryable && attempt < 2 {
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }

                    let drained_hex = if drained.is_empty() {
                        "none".into()
                    } else {
                        drained
                            .iter()
                            .map(|value| format!("{:02x}", value))
                            .collect::<Vec<_>>()
                            .join(" ")
                    };
                    let response_hex = response
                        .iter()
                        .map(|value| format!("{:02x}", value))
                        .collect::<Vec<_>>()
                        .join(" ");
                    return Err(AppError::FlashError(format!(
                        "Cmd {:02x} bad response [{}] (want {:02x}). Drained: {}",
                        cmd, response_hex, ACK, drained_hex
                    )));
                }
                Err(_) => {
                    let drained_hex = if drained.is_empty() {
                        "none".into()
                    } else {
                        drained
                            .iter()
                            .map(|value| format!("{:02x}", value))
                            .collect::<Vec<_>>()
                            .join(" ")
                    };
                    return Err(AppError::SerialError(format!(
                        "Cmd {:02x} timeout. Drained: {}",
                        cmd, drained_hex
                    )));
                }
            }
        }

        Err(AppError::FlashError(format!(
            "Cmd {:02x} NACKed after 3 attempts",
            cmd
        )))
    }

    pub fn get_commands(&mut self) -> AppResult<(u8, Vec<u8>)> {
        self.send_command(CMD_GET)?;

        let count = self.read_byte()? as usize;
        let data = self.read_vec(count + 1)?;
        self.expect_ack("Get")?;

        let version = data.first().copied().unwrap_or_default();
        let commands = data.get(1..).unwrap_or(&[]).to_vec();
        Ok((version, commands))
    }

    pub fn get_bootloader_version(&mut self) -> AppResult<(u8, Vec<u8>)> {
        self.send_command(CMD_GET_VERSION)?;

        let data = self.read_vec(3)?;
        self.expect_ack("GetVersion")?;

        Ok((data[0], data[1..].to_vec()))
    }

    pub fn get_chip_id(&mut self) -> AppResult<(u16, Option<u16>)> {
        self.send_command(CMD_GET_ID)?;

        let count = self.read_byte()? as usize;
        let data = self.read_vec(count + 1)?;
        self.expect_ack("GetID")?;

        let device_id = if data.len() >= 2 {
            u16::from_be_bytes([data[0], data[1]])
        } else {
            0
        };
        let pid = if data.len() >= 4 {
            Some(u16::from_be_bytes([data[2], data[3]]))
        } else {
            None
        };

        Ok((device_id, pid))
    }

    pub fn erase_flash(&mut self) -> AppResult<()> {
        self.send_command(CMD_ERASE)?;

        self.set_timeout(15_000)?;
        self.port.write_all(&[0xFF, 0x00])?;
        self.port.flush()?;
        let result = self.expect_ack("Erase");
        self.set_timeout(DEFAULT_TIMEOUT_MS)?;
        result
    }

    fn write_block(&mut self, address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() || data.len() > 256 {
            return Err(AppError::FlashError(
                "Write block size must be between 1 and 256 bytes".into(),
            ));
        }

        self.send_command(CMD_WRITE_MEMORY)?;
        self.send_address(address, "Write address")?;

        let len = (data.len() - 1) as u8;
        let checksum = data.iter().fold(len, |acc, &b| acc ^ b);

        let mut packet = Vec::with_capacity(data.len() + 2);
        packet.push(len);
        packet.extend_from_slice(data);
        packet.push(checksum);

        self.port.write_all(&packet)?;
        self.port.flush()?;
        self.expect_ack(&format!("Write {:08x}", address))
    }

    pub fn write_memory(&mut self, mut address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        for chunk in data.chunks(256) {
            self.write_block(address, chunk)?;
            address += chunk.len() as u32;
            std::thread::sleep(Duration::from_millis(2));
        }

        Ok(())
    }

    pub fn verify_memory(&mut self, mut address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        for chunk in data.chunks(256) {
            let read_data = self.read_memory(address, chunk.len())?;

            if read_data.len() != chunk.len() {
                return Err(AppError::VerifyFailed {
                    addr: address,
                    expected: chunk.len() as u8,
                    actual: read_data.len() as u8,
                });
            }

            for (index, (&expected, &actual)) in chunk.iter().zip(read_data.iter()).enumerate() {
                if expected != actual {
                    return Err(AppError::VerifyFailed {
                        addr: address + index as u32,
                        expected,
                        actual,
                    });
                }
            }

            address += chunk.len() as u32;
        }

        Ok(())
    }

    pub fn read_memory(&mut self, address: u32, size: usize) -> AppResult<Vec<u8>> {
        if size == 0 || size > 256 {
            return Err(AppError::FlashError("Read size must be 1-256 bytes".into()));
        }

        self.send_command(CMD_READ_MEMORY)?;
        self.send_address(address, "Read address")?;

        let len = (size - 1) as u8;
        self.port.write_all(&[len, !len])?;
        self.port.flush()?;
        self.expect_ack("Read length")?;

        self.read_vec(size)
    }

    pub fn set_dtr(&mut self, state: bool) -> AppResult<()> {
        self.port.write_data_terminal_ready(state)?;
        Ok(())
    }

    pub fn set_rts(&mut self, state: bool) -> AppResult<()> {
        self.port.write_request_to_send(state)?;
        Ok(())
    }

    pub fn go(&mut self, address: u32) -> AppResult<()> {
        self.send_command(CMD_GO)?;
        self.send_address(address, "Go address")
    }
}
