import type { GameState } from "../state/types";
import type { StateDiffEntry } from "./types";

/**
 * Full recursive boundary diff of two GameState snapshots.
 *
 * Arrays with items that carry an `id: string` field are aligned by ID, so
 * same-length replacements (e.g. gestation transfer, statusEffect lift) are
 * detected correctly. For append-only log arrays (chronicle, eventLog, etc.)
 * only the length is compared to avoid diffing large objects unnecessarily.
 */
export function diffGameState(before: GameState, after: GameState): StateDiffEntry[] {
  const out: StateDiffEntry[] = [];
  diffObject(
    out,
    "",
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    0,
  );
  return out;
}

// Arrays where we only report a length change (append-only logs, never mutated).
const LENGTH_ONLY_KEYS = new Set([
  "chronicle",
  "eventLog",
  "sceneHistory",
  "mentionLog",
  "eventReactionLog",
]);

function idOf(item: unknown): string | undefined {
  if (item !== null && typeof item === "object" && "id" in (item as object)) {
    const id = (item as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

function diffValue(
  out: StateDiffEntry[],
  path: string,
  before: unknown,
  after: unknown,
  depth: number,
): void {
  if (before === after) return;

  // Primitives: record immediately.
  if (
    before === null || after === null ||
    before === undefined || after === undefined ||
    typeof before !== "object" || typeof after !== "object"
  ) {
    if (before !== after) out.push({ path, before, after });
    return;
  }

  // Deep guard: fall back to JSON equality at high depth.
  if (depth > 8) {
    if (!jsonEq(before, after)) out.push({ path, before, after });
    return;
  }

  // Array vs non-array mismatch: record as single diff.
  if (Array.isArray(before) !== Array.isArray(after)) {
    out.push({ path, before, after });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    diffArray(out, path, before, after, depth);
    return;
  }

  diffObject(
    out,
    path,
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    depth,
  );
}

function diffArray(
  out: StateDiffEntry[],
  path: string,
  before: unknown[],
  after: unknown[],
  depth: number,
): void {
  // Length-only for known log arrays.
  const key = path.split(".").at(-1) ?? path;
  if (LENGTH_ONLY_KEYS.has(key) || LENGTH_ONLY_KEYS.has(path)) {
    if (before.length !== after.length) {
      out.push({ path, before: before.length, after: after.length });
    }
    return;
  }

  // ID-aligned diff if items carry stable `id` fields.
  const firstItem = before[0] ?? after[0];
  if (firstItem !== undefined && idOf(firstItem) !== undefined) {
    const bById = new Map<string, unknown>(
      before.map((item) => [idOf(item)!, item]),
    );
    const aById = new Map<string, unknown>(
      after.map((item) => [idOf(item)!, item]),
    );
    const allIds = [...new Set([...bById.keys(), ...aById.keys()])];
    for (const id of allIds) {
      diffValue(out, `${path}.${id}`, bById.get(id), aById.get(id), depth + 1);
    }
    return;
  }

  // Fallback: index-based comparison (catches same-length replacements).
  if (before.length !== after.length) {
    out.push({ path, before: before.length, after: after.length });
  }
  const minLen = Math.min(before.length, after.length);
  for (let i = 0; i < minLen; i++) {
    diffValue(out, `${path}[${i}]`, before[i], after[i], depth + 1);
  }
}

function diffObject(
  out: StateDiffEntry[],
  path: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  depth: number,
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    // Length-only for log arrays identified by key name.
    if (LENGTH_ONLY_KEYS.has(key)) {
      const bv = before[key];
      const av = after[key];
      const bl = Array.isArray(bv) ? bv.length : bv;
      const al = Array.isArray(av) ? av.length : av;
      if (bl !== al) out.push({ path: childPath, before: bl, after: al });
      continue;
    }
    diffValue(out, childPath, before[key], after[key], depth + 1);
  }
}
