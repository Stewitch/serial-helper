// Text encoding support for the serial monitor.
//
// Decoding uses the WebView's built-in TextDecoder (WHATWG encodings).
// TextEncoder only produces UTF-8, so for legacy encodings we build a reverse
// table from the same decoder. Encoding and decoding then round-trip exactly.

export type SerialEncoding = "UTF-8" | "GB18030" | "Shift-JIS" | "Latin1";

export const SERIAL_ENCODINGS: { value: SerialEncoding; label: string }[] = [
  { value: "UTF-8", label: "UTF-8" },
  { value: "GB18030", label: "GBK" },
  { value: "Shift-JIS", label: "Shift-JIS" },
  { value: "Latin1", label: "Latin-1" },
];

/** Maps stored setting values (including legacy ones) to a known encoding. */
export function normalizeEncoding(value: string | undefined | null): SerialEncoding {
  switch (value) {
    case "GB2312":
    case "GBK":
    case "GB18030":
      return "GB18030";
    case "Shift-JIS":
      return "Shift-JIS";
    case "Latin1":
      return "Latin1";
    default:
      return "UTF-8";
  }
}

const WHATWG_LABEL: Record<SerialEncoding, string> = {
  "UTF-8": "utf-8",
  GB18030: "gb18030",
  "Shift-JIS": "shift_jis",
  Latin1: "windows-1252",
};

export function createDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(WHATWG_LABEL[normalizeEncoding(encoding)]);
  } catch {
    return new TextDecoder("utf-8");
  }
}

type Range = [number, number];

interface MultiByteSpec {
  singles: Range[];
  leads: Range[];
  trails: Range[];
}

const SPECS: Record<Exclude<SerialEncoding, "UTF-8">, MultiByteSpec> = {
  GB18030: { singles: [[0x00, 0x80]], leads: [[0x81, 0xfe]], trails: [[0x40, 0x7e], [0x80, 0xfe]] },
  "Shift-JIS": {
    singles: [[0x00, 0x80], [0xa1, 0xdf]],
    leads: [[0x81, 0x9f], [0xe0, 0xfc]],
    trails: [[0x40, 0x7e], [0x80, 0xfc]],
  },
  Latin1: { singles: [[0x00, 0xff]], leads: [], trails: [] },
};

const tables = new Map<SerialEncoding, Map<string, number[]>>();

function* bytesIn(ranges: Range[]) {
  for (const [lo, hi] of ranges) for (let b = lo; b <= hi; b++) yield b;
}

function buildTable(encoding: Exclude<SerialEncoding, "UTF-8">): Map<string, number[]> {
  const spec = SPECS[encoding];
  const decoder = createDecoder(encoding);
  const table = new Map<string, number[]>();
  const add = (bytes: number[]) => {
    const ch = decoder.decode(Uint8Array.from(bytes));
    // Keep only sequences that decode to exactly one valid character.
    if (ch.length === 0 || ch.includes("�") || [...ch].length !== 1) return;
    if (!table.has(ch)) table.set(ch, bytes);
  };
  for (const b of bytesIn(spec.singles)) add([b]);
  for (const lead of bytesIn(spec.leads)) {
    for (const trail of bytesIn(spec.trails)) add([lead, trail]);
  }
  return table;
}

const QUESTION_MARK = 0x3f;

/** Encodes text to bytes. Characters the encoding cannot represent become "?". */
export function encodeText(text: string, encoding: string): number[] {
  const enc = normalizeEncoding(encoding);
  if (enc === "UTF-8") return Array.from(new TextEncoder().encode(text));

  let table = tables.get(enc);
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    if (!table) {
      table = buildTable(enc);
      tables.set(enc, table);
    }
    const bytes = table.get(ch);
    if (bytes) out.push(...bytes);
    else out.push(QUESTION_MARK);
  }
  return out;
}
