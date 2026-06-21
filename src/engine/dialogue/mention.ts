import type { GameTime } from "../calendar/time";
import type { GameState, MemoryMentionRecord } from "../state/types";

// MENTION_LOOKBACK_DAYS is in calendar "period" units (each year has 36 periods:
// 12 months × 3 periods). 30 periods ≈ 10 months, which is the intended cooldown window.
// (The brief listed 180 assuming 365-day years; the in-game calendar uses periods.)
export const MENTION_BOUNDS = { MAX_MENTIONS_PER_CHARACTER: 100, MENTION_LOOKBACK_DAYS: 30 } as const;

export function appendMention(state: GameState, rec: MemoryMentionRecord): GameState {
  const cutoff = rec.mentionedAt.dayIndex - MENTION_BOUNDS.MENTION_LOOKBACK_DAYS;
  const kept = [...state.mentionLog, rec].filter((m) => m.mentionedAt.dayIndex >= cutoff);
  // 每 speaker 至多 MAX：按 speaker 分组保留最近 MAX
  const perSpeaker = new Map<string, MemoryMentionRecord[]>();
  for (const m of kept) (perSpeaker.get(m.speakerId) ?? perSpeaker.set(m.speakerId, []).get(m.speakerId)!).push(m);
  const trimmed: MemoryMentionRecord[] = [];
  for (const list of perSpeaker.values()) {
    list.sort((x, y) => x.mentionedAt.dayIndex - y.mentionedAt.dayIndex);
    trimmed.push(...list.slice(-MENTION_BOUNDS.MAX_MENTIONS_PER_CHARACTER));
  }
  trimmed.sort((x, y) => x.mentionedAt.dayIndex - y.mentionedAt.dayIndex || (x.memoryId < y.memoryId ? -1 : 1));
  return { ...state, mentionLog: trimmed };
}

export function recentMentionPenalty(
  state: GameState,
  opts: { speakerId: string; audienceId: string; memoryId: string; now: GameTime },
): number {
  let penalty = 0;
  for (const m of state.mentionLog) {
    if (m.speakerId !== opts.speakerId || m.memoryId !== opts.memoryId) continue;
    const age = opts.now.dayIndex - m.mentionedAt.dayIndex;
    if (age < 0 || age > MENTION_BOUNDS.MENTION_LOOKBACK_DAYS) continue;
    const recency = 1 - age / MENTION_BOUNDS.MENTION_LOOKBACK_DAYS;       // 越近越接近 1
    const sameAudience = m.audienceId === opts.audienceId ? 1 : 0.3;      // 对同一人重复更扣
    penalty = Math.max(penalty, Math.round(80 * recency * sameAudience));
  }
  return Math.min(100, penalty);
}
