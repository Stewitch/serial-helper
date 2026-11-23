// Pure helpers for the flash page: map geometry and the step timeline.

/* ---------------- Page map ---------------- */

export interface FlashGeometry {
  start: number;
  size: number;
  /** Bytes represented by one cell. Equals the chip's page size unless the chip is too large to draw page by page. */
  cellBytes: number;
  cells: number;
}

/** Large chips are grouped so the map never exceeds this many cells (8 rows of 32). */
const MAX_CELLS = 256;

export function makeGeometry(start: number, size: number, pageSize: number): FlashGeometry {
  let cellBytes = Math.max(64, pageSize || 1024);
  while (size / cellBytes > MAX_CELLS) cellBytes *= 2;
  return { start, size, cellBytes, cells: Math.max(1, Math.ceil(size / cellBytes)) };
}

export function cellOf(geo: FlashGeometry, address: number): number {
  return Math.floor((address - geo.start) / geo.cellBytes);
}

/** Splits [address, address + length) across cells and calls `add` once per touched cell. */
export function forEachCellSpan(
  geo: FlashGeometry,
  address: number,
  length: number,
  add: (cell: number, bytes: number) => void
) {
  let at = Math.max(address, geo.start);
  const end = Math.min(address + length, geo.start + geo.size);
  while (at < end) {
    const cell = cellOf(geo, at);
    const cellEnd = geo.start + (cell + 1) * geo.cellBytes;
    const n = Math.min(end, cellEnd) - at;
    add(cell, n);
    at += n;
  }
}

/** How many firmware bytes land in each cell. Zero means the firmware does not touch that cell. */
export function firmwareBytesPerCell(geo: FlashGeometry, segments: { address: number; size: number }[]): number[] {
  const out = new Array<number>(geo.cells).fill(0);
  for (const seg of segments) {
    forEachCellSpan(geo, seg.address, seg.size, (cell, n) => {
      out[cell] += n;
    });
  }
  return out;
}

/* ---------------- Steps ---------------- */

export type StepId = "connect" | "detect" | "erase" | "write" | "verify" | "run";
export type StepStatus = "pending" | "current" | "done" | "failed";

export interface Step {
  id: StepId;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
}

export function buildSteps(avr: boolean, verify: boolean, runAfter: boolean): Step[] {
  const ids: StepId[] = avr
    ? ["connect", "write", ...(verify ? (["verify"] as const) : [])]
    : ["connect", "detect", "erase", "write", ...(verify ? (["verify"] as const) : []), ...(runAfter ? (["run"] as const) : [])];
  return ids.map((id) => ({ id, status: "pending" }));
}

/** Maps a backend progress stage to the step it belongs to. */
export function stepForStage(stage: string, avr: boolean): StepId | null {
  if (avr) {
    switch (stage) {
      case "parsing":
      case "detecting":
      case "connecting":
      case "enteringbootloader":
        return "connect";
      case "writing":
        return "write";
      case "verifying":
      case "reading":
        return "verify";
      default:
        return null;
    }
  }
  switch (stage) {
    case "parsing":
    case "connecting":
    case "bootloader":
    case "sync":
      return "connect";
    case "detecting":
      return "detect";
    case "erasing":
      return "erase";
    case "writing":
      return "write";
    case "verifying":
      return "verify";
    case "resetting":
      return "run";
    default:
      return null;
  }
}

/** Moves the timeline forward to `id`. Never moves backwards: the STM32 flow re-enters the bootloader after erasing. */
export function advanceSteps(steps: Step[], id: StepId, now: number): Step[] {
  const target = steps.findIndex((s) => s.id === id);
  const current = steps.findIndex((s) => s.status === "current");
  if (target < 0 || target <= current) {
    if (current < 0 && target >= 0 && steps[target].status === "pending") {
      return steps.map((s, i) => (i === target ? { ...s, status: "current", startedAt: now } : s));
    }
    return steps;
  }
  return steps.map((s, i) => {
    if (i < target && s.status !== "done") return { ...s, status: "done", startedAt: s.startedAt ?? now, endedAt: now };
    if (i === target) return { ...s, status: "current", startedAt: now };
    return s;
  });
}

export function finishSteps(steps: Step[], now: number): Step[] {
  return steps.map((s) =>
    s.status === "done" ? s : { ...s, status: "done", startedAt: s.startedAt ?? now, endedAt: now }
  );
}

export function failSteps(steps: Step[], now: number): Step[] {
  return steps.map((s) => (s.status === "current" ? { ...s, status: "failed", endedAt: now } : s));
}

/* ---------------- Formatting ---------------- */

export function hex32(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function parseHexInput(value: string): number | null {
  const trimmed = value.trim().replace(/^0x/i, "");
  if (!trimmed || !/^[0-9a-f]+$/i.test(trimmed)) return null;
  const parsed = parseInt(trimmed, 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
}
