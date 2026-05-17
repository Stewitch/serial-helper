use std::io::{Read, Write};
use std::time::Duration;

use serialport::SerialPort;

use crate::error::{AppError, AppResult};

/// STM32 ISP (In-System Programming) protocol via UART
pub struct Stm32Isp {
    port: Box<dyn SerialPort>,
}

// ISP Commands
const CMD_GET_VERSION: u8 = 0x01;
const CMD_GET_ID: u8 = 0x02;
const CMD_READ_MEMORY: u8 = 0x11;
const CMD_GO: u8 = 0x21;
const CMD_WRITE_MEMORY: u8 = 0x31;
const CMD_ERASE: u8 = 0x43;

const ACK: u8 = 0x79;
const NACK: u8 = 0x1F;
const SYNC_BYTE: u8 = 0x7F;

impl Stm32Isp {
    pub fn new(mut port: Box<dyn SerialPort>) -> AppResult<Self> {
        port.set_timeout(Duration::from_secs(3))?;
        Ok(Self { port })
    }

    fn set_timeout(&mut self, ms: u64) -> AppResult<()> {
        self.port.set_timeout(Duration::from_millis(ms))?;
        Ok(())
    }

    /// Enter bootloader by sending 0x7F and reading until we see ACK or NACK.
    /// User application data is discarded — we only respond to bootloader bytes.
    /// This matches FlyMCU's approach: keep reading, not waiting on timeouts.
    pub fn enter_bootloader(&mut self) -> AppResult<()> {
        // Short timeout per byte — we loop rapidly, not block
        self.set_timeout(50)?;

        let mut sync_sent = false;
        let start = std::time::Instant::now();

        loop {
            // Periodically send 0x7F if we haven't heard from the bootloader
            if !sync_sent || start.elapsed() > Duration::from_millis(200) {
                let _ = self.port.write_all(&[SYNC_BYTE]);
                let _ = self.port.flush();
                sync_sent = true;
            }

            let mut byte = [0u8; 1];
            match self.port.read_exact(&mut byte) {
                Ok(()) => {
                    match byte[0] {
                        ACK => {
                            self.set_timeout(5000)?;
                            return Ok(());
                        }
                        NACK => {
                            // Bootloader alive — re-send 0x7F immediately
                            sync_sent = false;
                        }
                        _ => {
                            // User application garbage — discard, keep reading
                        }
                    }
                }
                Err(_) => {
                    // Timeout (50ms with no data) — send another 0x7F
                    sync_sent = false;
                }
            }

            if start.elapsed() > Duration::from_secs(15) {
                break;
            }
        }

        self.set_timeout(5000)?;
        Err(AppError::FlashError(format!(
            "No bootloader response after 15s.\n\
             \u{2022} BOOT0 = HIGH (3.3V)?\n\
             \u{2022} Pressed reset after starting?\n\
             \u{2022} Correct COM port?",
        )))
    }

    /// Send a command (byte + its complement) and wait for ACK.
    /// Drains stale bytes first, then retries once on NACK.
    fn send_command(&mut self, cmd: u8) -> AppResult<()> {
        for attempt in 0..2 {
            // Drain any stale bytes before each attempt
            self.set_timeout(30)?;
            let mut buf = [0u8; 64];
            loop {
                match self.port.read(&mut buf) {
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
            self.set_timeout(5000)?;

            let complement = !cmd;
            self.port.write_all(&[cmd, complement])?;
            self.port.flush()?;

            let response = self.read_byte()?;
            if response == ACK {
                return Ok(());
            }
            if response == NACK && attempt == 0 {
                // Bootloader busy or not ready — small delay then retry
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            return Err(AppError::FlashError(format!(
                "Command {:#04x} rejected: {:#04x}", cmd, response
            )));
        }
        unreachable!()
    }

    /// Read a single byte with timeout
    fn read_byte(&mut self) -> AppResult<u8> {
        let mut buf = [0u8; 1];
        self.port.read_exact(&mut buf)?;
        Ok(buf[0])
    }

    /// Get the bootloader version and supported commands
    pub fn get_bootloader_version(&mut self) -> AppResult<(u8, Vec<u8>)> {
        self.send_command(CMD_GET_VERSION)?;

        // Bootloader sends: N (1 byte, where N+1 = data bytes), then N+1 data bytes
        let count = self.read_byte()? as usize;
        let mut data = vec![0u8; count];
        if count > 0 {
            self.port.read_exact(&mut data)?;
        }

        let version = if count > 1 { data[1] } else { 0 };
        let commands = if count > 3 {
            data[3..].to_vec()
        } else {
            vec![]
        };

        Ok((version, commands))
    }

    /// Get the chip device ID and PID
    pub fn get_chip_id(&mut self) -> AppResult<(u16, Option<u16>)> {
        self.send_command(CMD_GET_ID)?;

        // Bootloader sends: N (1 byte), then N+1 data bytes
        let count = self.read_byte()? as usize;
        let mut data = vec![0u8; count];
        if count > 0 {
            self.port.read_exact(&mut data)?;
        }

        let device_id = if count >= 2 {
            u16::from_be_bytes([data[0], data[1]])
        } else {
            0
        };

        let pid = if count >= 4 {
            Some(u16::from_be_bytes([data[2], data[3]]))
        } else {
            None
        };

        Ok((device_id, pid))
    }

    /// Erase all flash (global erase)
    pub fn erase_flash(&mut self) -> AppResult<()> {
        // Global erase: send code byte + complement + XOR checksum
        self.send_command(CMD_ERASE)?;

        let code: u8 = 0xFF;          // global erase code
        let complement = !code;        // 0x00
        let checksum = code ^ complement; // 0xFF
        self.port.write_all(&[code, complement, checksum])?;
        self.port.flush()?;

        let response = self.read_byte()?;
        if response != ACK {
            return Err(AppError::FlashError(format!(
                "Erase failed: {:#04x}", response
            )));
        }

        // Wait for erase to complete (varies by chip size; 3s is safe for most)
        std::thread::sleep(Duration::from_secs(3));
        Ok(())
    }

    /// Write a block of data to flash memory (max 256 bytes per block)
    fn write_block(&mut self, address: u32, data: &[u8]) -> AppResult<()> {
        self.send_command(CMD_WRITE_MEMORY)?;

        let addr_bytes = address.to_be_bytes();
        let len = data.len() as u8;
        let checksum = addr_bytes[0]
            ^ addr_bytes[1]
            ^ addr_bytes[2]
            ^ addr_bytes[3]
            ^ len
            ^ data.iter().fold(0u8, |acc, &b| acc ^ b);

        let mut packet = Vec::with_capacity(5 + data.len() + 1);
        packet.extend_from_slice(&addr_bytes);
        packet.push(len);
        packet.extend_from_slice(data);
        packet.push(checksum);

        self.port.write_all(&packet)?;
        self.port.flush()?;

        let response = self.read_byte()?;
        if response != ACK {
            return Err(AppError::FlashError(format!(
                "Write failed at {:#010x}: {:#04x}", address, response
            )));
        }

        Ok(())
    }

    /// Write data to flash memory, splitting into 256-byte blocks
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

    /// Verify written data against source
    pub fn verify_memory(&mut self, mut address: u32, data: &[u8]) -> AppResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        for chunk in data.chunks(256) {
            self.send_command(CMD_READ_MEMORY)?;

            let addr_bytes = address.to_be_bytes();
            let len = chunk.len() as u8;
            let checksum = addr_bytes[0]
                ^ addr_bytes[1]
                ^ addr_bytes[2]
                ^ addr_bytes[3]
                ^ len;

            self.port.write_all(&[&addr_bytes[..], &[len, checksum]].concat())?;
            self.port.flush()?;

            let read_len = self.read_byte()? as usize;
            let mut read_data = vec![0u8; read_len];
            if read_len > 0 {
                self.port.read_exact(&mut read_data)?;
            }

            if read_data.len() != chunk.len() {
                return Err(AppError::VerifyFailed {
                    addr: address,
                    expected: chunk.len() as u8,
                    actual: read_data.len() as u8,
                });
            }

            for (i, (&expected, &actual)) in chunk.iter().zip(read_data.iter()).enumerate() {
                if expected != actual {
                    return Err(AppError::VerifyFailed {
                        addr: address + i as u32,
                        expected,
                        actual,
                    });
                }
            }

            address += chunk.len() as u32;
        }

        Ok(())
    }

    /// Read memory from flash (public — used by read_flash command)
    pub fn read_memory(&mut self, address: u32, size: usize) -> Result<Vec<u8>, AppError> {
        if size == 0 || size > 256 {
            return Err(AppError::FlashError("Read size must be 1-256 bytes".into()));
        }

        self.send_command(CMD_READ_MEMORY)?;

        let addr_bytes = address.to_be_bytes();
        let len = size as u8;
        let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3] ^ len;

        self.port.write_all(&[&addr_bytes[..], &[len, checksum]].concat())?;
        self.port.flush()?;

        let read_len = self.read_byte()? as usize;
        let mut data = vec![0u8; read_len];
        if read_len > 0 {
            self.port.read_exact(&mut data)?;
        }

        // Truncate to requested size if bootloader sent more
        data.truncate(size);
        Ok(data)
    }

    /// Set DTR line (typically connected to BOOT0 via one-click circuit)
    pub fn set_dtr(&mut self, state: bool) -> Result<(), AppError> {
        self.port.write_data_terminal_ready(state)?;
        Ok(())
    }

    /// Set RTS line (typically connected to RESET via one-click circuit)
    pub fn set_rts(&mut self, state: bool) -> Result<(), AppError> {
        self.port.write_request_to_send(state)?;
        Ok(())
    }

    /// Jump to user application at the given address
    pub fn go(&mut self, address: u32) -> AppResult<()> {
        self.send_command(CMD_GO)?;

        let addr_bytes = address.to_be_bytes();
        let checksum = addr_bytes[0] ^ addr_bytes[1] ^ addr_bytes[2] ^ addr_bytes[3];
        self.port.write_all(&[&addr_bytes[..], &[checksum]].concat())?;
        self.port.flush()?;

        Ok(())
    }
}
