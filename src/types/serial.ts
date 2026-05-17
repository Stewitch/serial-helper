export interface PortInfo {
  name: string;
  description: string;
  vid: number;
  pid: number;
  serialNumber: string | null;
  manufacturer: string | null;
  productName: string | null;
}

export interface SerialConfig {
  port_name: string;
  baud_rate: number;
  data_bits: "Five" | "Six" | "Seven" | "Eight";
  stop_bits: "One" | "Two";
  parity: "None" | "Even" | "Odd";
  flow_control: "None" | "Hardware" | "Software";
}

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600,
  115200, 230400, 460800, 921600,
] as const;

export type BaudRate = (typeof BAUD_RATES)[number];

export const DATA_BITS_OPTIONS = [5, 6, 7, 8] as const;
export const STOP_BITS_OPTIONS = [1, 2] as const;
export const PARITY_OPTIONS = ["None", "Even", "Odd"] as const;
export const FLOW_CONTROL_OPTIONS = ["None", "Hardware", "Software"] as const;
