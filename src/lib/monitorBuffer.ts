// App-wide monitor log. Lives outside React so data keeps arriving while the
// monitor page is unmounted or the view is paused.
import { createDecoder } from "./textCodec";

export type LineType = "rx" | "tx" | "system" | "error" | "warn";

export interface MonitorLine {
  readonly id: number;
  readonly type: LineType;
  readonly text: string;
  /** Time the line started, ms since epoch. */
  readonly ts: number;
}

/** A device that never sends a newline would otherwise grow one line forever. */
const MAX_LINE_CHARS = 4096;
const LINE_BREAK = /\r\n|\r|\n/;

let lines: MonitorLine[] = [];
let nextId = 0;
/** True when the last line is an RX line still waiting for its line break. */
let openRx = false;
/** The previous RX chunk ended in "\r"; a leading "\n" in the next one belongs to it. */
let pendingCR = false;
let maxLines = 50000;
let encoding = "UTF-8";
let decoder = createDecoder(encoding);

let version = 0;
const listeners = new Set<() => void>();
let notifyScheduled = false;

function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Coalesce bursts of serial data into at most one render per frame.
  // rAF does not run while the window is hidden or minimized, so a timer
  // backs it up; whichever fires first flushes.
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (!notifyScheduled) return;
    notifyScheduled = false;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    version++;
    listeners.forEach((l) => l());
  };
  if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(flush);
  timer = setTimeout(flush, 50);
}

function trim() {
  // Trim in batches so we are not copying the array on every line.
  const slack = Math.max(100, Math.floor(maxLines / 10));
  if (lines.length > maxLines + slack) {
    lines = lines.slice(lines.length - maxLines);
  }
}

function push(type: LineType, text: string, ts: number) {
  lines.push({ id: nextId++, type, text, ts });
}

function closeRx(ts: number) {
  // A line break with no open line is an empty line.
  if (!openRx) push("rx", "", ts);
  openRx = false;
}

function appendToRx(text: string, ts: number) {
  let rest = text;
  while (rest.length > 0) {
    if (!openRx) {
      push("rx", "", ts);
      openRx = true;
    }
    const last = lines[lines.length - 1];
    const room = MAX_LINE_CHARS - last.text.length;
    const piece = rest.slice(0, room);
    lines[lines.length - 1] = { ...last, text: last.text + piece };
    rest = rest.slice(piece.length);
    if (lines[lines.length - 1].text.length >= MAX_LINE_CHARS) openRx = false;
  }
}

function appendDecodedRx(raw: string, ts: number) {
  let text = raw;
  if (pendingCR && text.startsWith("\n")) text = text.slice(1);
  if (text.length === 0) return;
  pendingCR = text.endsWith("\r");

  const parts = text.split(LINE_BREAK);
  parts.forEach((part, i) => {
    if (i > 0) closeRx(ts);
    if (part.length > 0) appendToRx(part, ts);
  });
}

export const monitorBuffer = {
  /** Feeds raw received bytes. Multi-byte characters split across chunks are kept intact. */
  appendRx(bytes: Uint8Array, ts = Date.now()) {
    appendDecodedRx(decoder.decode(bytes, { stream: true }), ts);
    trim();
    notify();
  },

  /** Adds complete lines of a non-RX kind (sent data, status messages). */
  appendLine(type: Exclude<LineType, "rx">, text: string, ts = Date.now()) {
    openRx = false;
    pendingCR = false;
    // A single trailing line ending (e.g. the one appended on send) is not an extra line.
    const body = text.replace(/(\r\n|\r|\n)$/, "");
    for (const line of body.split(LINE_BREAK)) push(type, line, ts);
    trim();
    notify();
  },

  clear() {
    lines = [];
    openRx = false;
    pendingCR = false;
    notify();
  },

  setEncoding(value: string) {
    if (value === encoding) return;
    encoding = value;
    decoder = createDecoder(value);
  },

  getEncoding() {
    return encoding;
  },

  /** Drops any partial multi-byte sequence, e.g. when the port closes. */
  resetDecoder() {
    decoder = createDecoder(encoding);
    pendingCR = false;
  },

  setMaxLines(value: number) {
    maxLines = Math.max(1000, value);
    trim();
  },

  getLines(): readonly MonitorLine[] {
    return lines;
  },

  getVersion() {
    return version;
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
