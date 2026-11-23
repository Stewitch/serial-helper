import type { SerialConfig, PortInfo } from "@/types/serial";

type FrameFields = Pick<SerialConfig, "data_bits" | "parity" | "stop_bits">;

const DATA_BITS: Record<SerialConfig["data_bits"], string> = { Five: "5", Six: "6", Seven: "7", Eight: "8" };
const PARITY: Record<SerialConfig["parity"], string> = { None: "N", Even: "E", Odd: "O" };
const STOP_BITS: Record<SerialConfig["stop_bits"], string> = { One: "1", Two: "2" };

/** Formats data bits, parity and stop bits the way datasheets write them, e.g. "8N1". */
export function frameLabel(config: FrameFields): string {
  return `${DATA_BITS[config.data_bits]}${PARITY[config.parity]}${STOP_BITS[config.stop_bits]}`;
}

/** Frame formats offered in the title bar; covers what real devices use. */
export const FRAME_PRESETS: FrameFields[] = [
  { data_bits: "Eight", parity: "None", stop_bits: "One" },
  { data_bits: "Eight", parity: "Even", stop_bits: "One" },
  { data_bits: "Eight", parity: "Odd", stop_bits: "One" },
  { data_bits: "Eight", parity: "None", stop_bits: "Two" },
  { data_bits: "Seven", parity: "Even", stop_bits: "One" },
  { data_bits: "Seven", parity: "Odd", stop_bits: "One" },
];

export function parseFrameLabel(label: string): FrameFields | undefined {
  return FRAME_PRESETS.find((p) => frameLabel(p) === label);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sorts COM ports numerically (COM2 before COM10), then everything else by name. */
export function sortPorts(ports: PortInfo[]): PortInfo[] {
  const key = (name: string) => {
    const m = name.match(/^COM(\d+)$/i);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return [...ports].sort((a, b) => key(a.name) - key(b.name) || a.name.localeCompare(b.name));
}

/** Short device name for a port, e.g. "CH340" or "Arduino Uno". */
export function portHint(port: PortInfo): string | undefined {
  const raw = port.productName || port.manufacturer || undefined;
  if (!raw) return undefined;
  // Windows appends the port to the product name: "USB-SERIAL CH340 (COM3)".
  return raw.replace(/\s*\(COM\d+\)\s*$/i, "").replace(/^USB-SERIAL\s+/i, "");
}
