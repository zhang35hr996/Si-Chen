/**
 * Memory v0 inspection (skeleton-plan §7) — READ-ONLY helpers for the debug
 * panel. Writing happens exclusively through the effect funnel (`memory`
 * effects) and the authored seeds in createNewGameState; nothing here
 * mutates, scores, retrieves-for-prompts, or consolidates (all excluded
 * from v0 by design).
 */
import type { GameTime } from "../calendar/time";
import type { GameState, MemoryEntry } from "../state/types";

/** Entries for one character, oldest → newest. [] for unknown characters. */
export function listMemories(state: GameState, charId: string): readonly MemoryEntry[] {
  return state.memories[charId]?.entries ?? [];
}

/** Whole-store overview for the debug panel header. */
export function memoryOverview(
  state: GameState,
): { charId: string; count: number; permanentCount: number }[] {
  return Object.entries(state.memories).map(([charId, store]) => ({
    charId,
    count: store.entries.length,
    permanentCount: store.entries.filter((e) => e.retention === "permanent").length,
  }));
}

/** Age in action-days relative to `now` (0 = written this action-day). */
export function memoryAgeDays(entry: MemoryEntry, now: GameTime): number {
  return Math.max(0, now.dayIndex - entry.createdAt.dayIndex);
}

/** Human label for the debug panel's origin column. */
export function memoryOriginLabel(entry: MemoryEntry): string {
  return entry.sourceEventId ? `事件 ${entry.sourceEventId}` : "授定/直写";
}
