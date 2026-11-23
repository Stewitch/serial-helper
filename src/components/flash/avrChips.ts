// Mirrors the parts in src-tauri/src/flash/avr_chips.rs that the UI offers.

export interface AvrChipOption {
  value: string; // avrdude part id
  name: string;
  flashKb: number;
  ramKb: number;
  pageSize: number;
}

export const AVR_CHIPS: AvrChipOption[] = [
  { value: "m328p", name: "ATmega328P", flashKb: 32, ramKb: 2, pageSize: 128 },
  { value: "m328", name: "ATmega328", flashKb: 32, ramKb: 2, pageSize: 128 },
  { value: "m2560", name: "ATmega2560", flashKb: 256, ramKb: 8, pageSize: 256 },
  { value: "m32u4", name: "ATmega32U4", flashKb: 32, ramKb: 2.5, pageSize: 128 },
  { value: "m168p", name: "ATmega168P", flashKb: 16, ramKb: 1, pageSize: 128 },
  { value: "m168", name: "ATmega168", flashKb: 16, ramKb: 1, pageSize: 128 },
  { value: "m88p", name: "ATmega88P", flashKb: 8, ramKb: 1, pageSize: 64 },
  { value: "m644p", name: "ATmega644P", flashKb: 64, ramKb: 4, pageSize: 256 },
  { value: "m1284p", name: "ATmega1284P", flashKb: 128, ramKb: 16, pageSize: 256 },
  { value: "t85", name: "ATtiny85", flashKb: 8, ramKb: 0.5, pageSize: 64 },
  { value: "t84", name: "ATtiny84", flashKb: 8, ramKb: 0.5, pageSize: 64 },
  { value: "m8", name: "ATmega8", flashKb: 8, ramKb: 1, pageSize: 64 },
];

export const AVR_PROGRAMMERS = [
  { value: "arduino", label: "Arduino" },
  { value: "avrisp", label: "AVR ISP" },
  { value: "usbasp", label: "USBasp" },
  { value: "usbtiny", label: "USBtinyISP" },
  { value: "stk500v1", label: "STK500 v1" },
  { value: "stk500v2", label: "STK500 v2" },
];
