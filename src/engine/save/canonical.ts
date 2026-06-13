/**
 * Canonical JSON + checksum. The checksum is for CORRUPTION/TAMPER DETECTION,
 * NOT cryptographic security and NOT anti-cheat. A local single-player game
 * has nothing to defend against a determined player editing their own save;
 * the goal is only to catch bad JSON, accidental hand-edits, and truncated
 * writes. A synchronous 64-bit FNV-1a keeps the whole save path sync
 * (crypto.subtle would force async through every caller). Documented
 * deviation from the plan's sha-256.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"; // undefined → null (never inside saved state)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
}

/** Two independent 32-bit FNV-1a passes → 16 hex chars. */
export function fnv1a64Hex(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((code << 1) | 1), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function checksumOf(value: unknown): string {
  return fnv1a64Hex(canonicalStringify(value));
}
