use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PortInfo {
    pub name: String,
    pub description: String,
    pub vid: u16,
    pub pid: u16,
    #[serde(rename = "serialNumber")]
    pub serial_number: Option<String>,
    #[serde(rename = "manufacturer")]
    pub manufacturer: Option<String>,
    #[serde(rename = "productName")]
    pub product_name: Option<String>,
}

pub struct PortScanner;

impl PortScanner {
    pub fn list_ports() -> Vec<PortInfo> {
        serialport::available_ports()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                let name = p.port_name;
                let mut info = PortInfo {
                    name: name.clone(),
                    description: name.clone(),
                    vid: 0,
                    pid: 0,
                    serial_number: None,
                    manufacturer: None,
                    product_name: None,
                };

                match p.port_type {
                    serialport::SerialPortType::UsbPort(usb) => {
                        info.vid = usb.vid;
                        info.pid = usb.pid;
                        info.serial_number = usb.serial_number;
                        info.manufacturer = usb.manufacturer;
                        info.product_name = usb.product;
                        info.description = format!(
                            "{} (VID:{:04X} PID:{:04X})",
                            name,
                            usb.vid,
                            usb.pid
                        );
                    }
                    serialport::SerialPortType::PciPort => {
                        info.description = format!("{} (PCI)", name);
                    }
                    serialport::SerialPortType::BluetoothPort => {
                        info.description = format!("{} (Bluetooth)", name);
                    }
                    serialport::SerialPortType::Unknown => {
                        info.description = format!("{} (Unknown)", name);
                    }
                }
                info
            })
            .collect()
    }

    pub fn find_port(name: &str) -> Option<PortInfo> {
        Self::list_ports().into_iter().find(|p| p.name == name)
    }
}
