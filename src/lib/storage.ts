/**
 * Moves a value saved under a retired localStorage key to its new key and
 * returns it. Returns null when nothing was saved under the old key.
 */
export function migrateKey(oldKey: string, newKey: string): string | null {
  const value = localStorage.getItem(oldKey);
  if (value === null) return null;
  localStorage.setItem(newKey, value);
  localStorage.removeItem(oldKey);
  return value;
}
