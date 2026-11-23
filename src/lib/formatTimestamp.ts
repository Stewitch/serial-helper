export function formatTimestamp(ts: number, format: string): string {
  const d = new Date(ts);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return format
    .replace("HH", pad(d.getHours(), 2))
    .replace("mm", pad(d.getMinutes(), 2))
    .replace("ss", pad(d.getSeconds(), 2))
    .replace("SSS", pad(d.getMilliseconds(), 3));
}
