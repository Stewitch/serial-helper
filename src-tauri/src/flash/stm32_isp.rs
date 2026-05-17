use std::io::{Read, Write};
use std::time::Duration;

use serialport::SerialPort;

use crate::error::{AppError, AppResult};

pub struct Stm32Isp {
    port: Box<dyn SerialPort>,
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

// STM32F4 bootloader also responds with 0xFC during auto-baud
const BOOTLOADER_BYTES: &[u8] = &[ACK, NACK, 0xFC];

impl Stm32Isp {
    pub fn new(mut port: Box<dyn SerialPort>) -> AppResult<Self> {
        port.set_timeout(Duration::from_secs(3))?;
        Ok(Self { port })
    }

    fn set_timeout(&mut self, ms: u64) -> AppResult<()> {
        self.port.set_timeout(Duration::from_millis(ms))?;
        Ok(())
    }

    /// Enter bootloader: send 0x7F, read all bytes, look for bootloader response.
    /// Calls `on_bytes` with each batch for real-time logging (FlyMCU-style).
    pub fn enter_bootloader(&mut self, on_bytes: &dyn Fn(&[u8])) -> AppResult<()> {
        let mut all_bytes: Vec<u8> = Vec::new();
        self.set_timeout(8)?;
        let start = std::time::Instant::now();
        let mut last_report = start;

        loop {
            self.port.write_all(&[SYNC_BYTE])?;
            self.port.flush()?;
            std::thread::sleep(Duration::from_millis(2));

            let mut buf = [0u8; 256];
            let mut batch: Vec<u8> = Vec::new();
            match self.port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    batch.extend_from_slice(&buf[..n]);
                    loop {
                        match self.port.read(&mut buf) {
                            Ok(m) if m > 0 => { batch.extend_from_slice(&buf[..m]); }
                            _ => break,
                        }
                    }
                }
                _ => {}
            }

            if !batch.is_empty() {
                all_bytes.extend_from_slice(&batch);

                // Real-time logging: report every ~500ms
                if last_report.elapsed() > Duration::from_millis(500) {
                    on_bytes(&all_bytes);
                    last_report = std::time::Instant::now();
                }

                // ACK → fresh sync
                if all_bytes.contains(&ACK) {
                    self.set_timeout(5000)?;
                    on_bytes(&all_bytes); // final report
                    return Ok(());
                }

                // All bytes are from bootloader (no user-app data mixed in)
                let all_bootloader = !all_bytes.is_empty()
                    && all_bytes.iter().all(|b| BOOTLOADER_BYTES.contains(b));
                if all_bootloader {
                    self.set_timeout(5000)?;
                    on_bytes(&all_bytes);
                    return Ok(());
                }
            }

            if start.elapsed() > Duration::from_secs(15) {
                break;
            }
        }

        self.set_timeout(5000)?;
        on_bytes(&all_bytes);
        Err(AppError::FlashError(format!(
            "No bootloader after 15s. Bytes seen: {}",
            all_bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")
        )))
    }

    fn send_command(&mut self, cmd: u8) -> AppResult<()> {
        for attempt in 0..3 {
            self.set_timeout(30)?;
            let mut drained: Vec<u8> = Vec::new();
            let mut buf = [0u8; 64];
            loop {
                match self.port.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => { drained.extend_from_slice(&buf[..n]); continue; }
                    Err(_) => break,
                }
            }
            self.set_timeout(5000)?;

            let complement = !cmd;
            self.port.write_all(&[cmd, complement])?;
            self.port.flush()?;

            match self.read_byte() {
                Ok(ACK) => return Ok(()),
                Ok(NACK) if attempt < 2 => {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Ok(b) => {
                    let d = if drained.is_empty() { "none".into() }
                        else { drained.iter().map(|x| format!("{:02x}", x)).collect::<Vec<_>>().join(" ") };
                    return Err(AppError::FlashError(format!(
                        "Cmd {:02x}→{:02x} (want {:02x}). Drained: {}", cmd, b, ACK, d
                    )));
                }
                Err(_) => {
                    let d = if drained.is_empty() { "none".into() }
                        else { drained.iter().map(|x| format!("{:02x}", x)).collect::<Vec<_>>().join(" ") };
                    return Err(AppError::SerialError(format!(
                        "Cmd {:02x} timeout. Drained: {}", cmd, d
                    )));
                }
            }
        }
        Err(AppError::FlashError(format!("Cmd {:02x} NACKed after 3 attempts", cmd)))
    }

    fn read_byte(&mut self) -> AppResult<u8> {
        let mut buf = [0u8; 1];
        self.port.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    pub fn get_commands(&mut self) -> AppResult<(u8, Vec<u8>)> {
        self.send_command(CMD_GET)?;
        let n = self.read_byte()? as usize;
        let len = n + 1;
        let mut data = vec![0u8; len];
        if len > 0 { self.port.read_exact(&mut data)?; }
        let version = if len > 0 { data[0] } else { 0 };
        let commands = if len > 1 { data[1..].to_vec() } else { vec![] };
        Ok((version, commands))
    }

    pub fn get_bootloader_version(&mut self) -> AppResult<(u8, Vec<u8>)> {
        self.send_command(CMD_GET_VERSION)?;
        let n = self.read_byte()? as usize;
        let len = n + 1;
        let mut data = vec![0u8; len];
        if len > 0 { self.port.read_exact(&mut data)?; }
        let version = if len > 1 { data[1] } else { 0 };
        let commands = if len > 3 { data[3..].to_vec() } else { vec![] };
        Ok((version, commands))
    }

    pub fn get_chip_id(&mut self) -> AppResult<(u16, Option<u16>)> {
        self.send_command(CMD_GET_ID)?;
        let n = self.read_byte()? as usize;
        let len = n + 1;
        let mut data = vec![0u8; len];
        if len > 0 { self.port.read_exact(&mut data)?; }
        let device_id = if len >= 2 { u16::from_be_bytes([data[0], data[1]]) } else { 0 };
        let pid = if len >= 4 { Some(u16::from_be_bytes([data[2], data[3]])) } else { None };
        Ok((device_id, pid))
    }

    pub fn erase_flash(&mut self) -> AppResult<()> {
        self.send_command(CMD_ERASE)?;
        let code: u8 = 0xFF;
        let complement = !code;
        let checksum = code ^ complement;
        self.port.write_all(&[code, complement, checksum])?;
        self.port.flush()?;
        let response = self.read_byte()?;
        if response != ACK {
            return Err(AppError::FlashError(format!("Erase failed: {:02x}", response)));
        }
        std::thread::sleep(Duration::from_secs(3));
        Ok(())
    }

    fn write_block(&mut self, address: u32, data: &[u8]) -> AppResult<()> {
        self.send_command(CMD_WRITE_MEMORY)?;
        let addr_bytes = address.to_be_bytes();
        let len = data.len() as u8;
        let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3]
            ^ len ^ data.iter().fold(0u8, |acc, &b| acc ^ b);
        let mut packet = Vec::with_capacity(5 + data.len() + 1);
        packet.extend_from_slice(&addr_bytes);
        packet.push(len);
        packet.extend_from_slice(data);
        packet.push(checksum);
        self.port.write_all(&packet)?;
        self.port.flush()?;
        let response = self.read_byte()?;
        if response != ACK {
            return Err(AppError::FlashError(format!("Write fail {:08x}: {:02x}", address, response)));
        }
        Ok(())
    }

    pub fn write_memory(&mut self, mut address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() { return Ok(()); }
        for chunk in data.chunks(256) {
            self.write_block(address, chunk)?;
            address += chunk.len() as u32;
            std::thread::sleep(Duration::from_millis(2));
        }
        Ok(())
    }

    pub fn verify_memory(&mut self, mut address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() { return Ok(()); }
        for chunk in data.chunks(256) {
            self.send_command(CMD_READ_MEMORY)?;
            let addr_bytes = address.to_be_bytes();
            let len = chunk.len() as u8;
            let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3] ^ len;
            self.port.write_all(&[&addr_bytes[..], &[len, checksum]].concat())?;
            self.port.flush()?;
            let read_len = self.read_byte()? as usize;
            let mut read_data = vec![0u8; read_len];
            if read_len > 0 { self.port.read_exact(&mut read_data)?; }
            if read_data.len() != chunk.len() {
                return Err(AppError::VerifyFailed { addr: address, expected: chunk.len() as u8, actual: read_data.len() as u8 });
            }
            for (i, (&e, &a)) in chunk.iter().zip(read_data.iter()).enumerate() {
                if e != a { return Err(AppError::VerifyFailed { addr: address + i as u32, expected: e, actual: a }); }
            }
            address += chunk.len() as u32;
        }
        Ok(())
    }

    pub fn read_memory(&mut self, address: u32, size: usize) -> Result<Vec<u8>, AppError> {
        if size == 0 || size > 256 { return Err(AppError::FlashError("Read size 1-256".into())); }
        self.send_command(CMD_READ_MEMORY)?;
        let addr_bytes = address.to_be_bytes();
        let len = size as u8;
        let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3] ^ len;
        self.port.write_all(&[&addr_bytes[..], &[len, checksum]].concat())?;
        self.port.flush()?;
        let read_len = self.read_byte()? as usize;
        let mut data = vec![0u8; read_len];
        if read_len > 0 { self.port.read_exact(&mut data)?; }
        data.truncate(size);
        Ok(data)
    }

    pub fn set_dtr(&mut self, state: bool) -> Result<(), AppError> {
        self.port.write_data_terminal_ready(state)?;
        Ok(())
    }

    pub fn set_rts(&mut self, state: bool) -> Result<(), AppError> {
        self.port.write_request_to_send(state)?;
        Ok(())
    }

    pub fn go(&mut self, address: u32) -> AppResult<()> {
        self.send_command(CMD_GO)?;
        let addr_bytes = address.to_be_bytes();
        let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3];
        self.port.write_all(&[&addr_bytes[..], &[checksum]].concat())?;
        self.port.flush()?;
        Ok(())
    }
}
