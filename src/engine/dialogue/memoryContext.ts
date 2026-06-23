import { canKnowEvent } from "../chronicle/awareness";
import { recallCandidates, type RecallQuery } from "./recall";
import { rankCandidates } from "./rerank";
import { eventActivationScore, type ActivationContext } from "./retrievalScore";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export interface DialogueMemoryContext {
  activatedMemories: MemoryEntry[];
  knownEvents: CourtEvent[];
  /** All events the speaker can know, without any salience quota. */
  knownEventsAll: readonly CourtEvent[];
}

// ── recallKnownEvents ─────────────────────────────────────────────────────────

/**
 * Returns ALL CourtEvent instances from `state.chronicle` that the speaker is
 * entitled to know (canKnowEvent). No salience quota — returns everything.
 */
export function recallKnownEvents(
  state: GameState,
  speakerId: string,
): CourtEvent[] {
  return state.chronicle.filter((e) => canKnowEvent(state, speakerId, e));
}

// ── selectPromptEvents ────────────────────────────────────────────────────────

export interface SelectPromptEventsOpts {
  events: CourtEvent[];
  /** If set, this event must appear first in the result. Must exist in `events`. */
  pinnedEventId?: string;
  limit: number;
}

/**
 * Selects up to `limit` events for use in a dialogue prompt.
 *
 * - Throws if `limit < 1`.
 * - Throws if `pinnedEventId` is provided but not found in `events`.
 * - When pinned event is present, it always appears first.
 * - Remaining slots are filled by: publicSalience desc → occurredAt.dayIndex desc → id asc.
 * - Result length ≤ limit.
 */
export function selectPromptEvents(opts: SelectPromptEventsOpts): CourtEvent[] {
  const { events, pinnedEventId, limit } = opts;

  if (limit < 1) {
    throw new RangeError(`selectPromptEvents: limit must be ≥ 1, got ${limit}`);
  }

  let pinned: CourtEvent | undefined;
  if (pinnedEventId !== undefined) {
    pinned = events.find((e) => e.id === pinnedEventId);
    if (!pinned) {
      throw new Error(
        `selectPromptEvents: pinnedEventId "${pinnedEventId}" not found in events array`,
      );
    }
  }

  // Sort candidates (excluding the pinned event, which always goes first)
  const candidates = events
    .filter((e) => e.id !== pinnedEventId)
    .sort(
      (a, b) =>
        // 1. publicSalience descending
        b.publicSalience - a.publicSalience ||
        // 2. occurredAt descending (dayIndex)
        b.occurredAt.dayIndex - a.occurredAt.dayIndex ||
        // 3. id ascending (deterministic tiebreak)
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const result: CourtEvent[] = [];
  if (pinned) result.push(pinned);

  for (const e of candidates) {
    if (result.length >= limit) break;
    result.push(e);
  }

  return result;
}

// ── selectPromptEventsByActivation (PR-A item 9) ──────────────────────────────

export interface SelectPromptEventsByActivationOpts {
  state: GameState;
  events: readonly CourtEvent[];
  ctx: ActivationContext;
  /** If set, this event must appear first. Throws if not present in `events`. */
  pinnedEventId?: string;
  limit: number;
}

/**
 * Selects up to `limit` events for a dialogue prompt, ranked by unified
 * eventActivationScore (decayed salience × relevance + present bonus − recent
 * reaction) instead of raw publicSalience. The reaction source event, when given,
 * is always pinned first. Deterministic tiebreak: score desc → occurredAt desc → id asc.
 */
export function selectPromptEventsByActivation(opts: SelectPromptEventsByActivationOpts): CourtEvent[] {
  const { state, events, ctx, pinnedEventId, limit } = opts;
  if (limit < 1) throw new RangeError(`selectPromptEventsByActivation: limit must be ≥ 1, got ${limit}`);

  let pinned: CourtEvent | undefined;
  if (pinnedEventId !== undefined) {
    pinned = events.find((e) => e.id === pinnedEventId);
    if (!pinned) {
      throw new Error(`selectPromptEventsByActivation: pinnedEventId "${pinnedEventId}" not found in events array`);
    }
  }

  const scored = events
    .filter((e) => e.id !== pinnedEventId)
    .map((e) => ({ e, score: eventActivationScore(state, e, ctx) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.e.occurredAt.dayIndex - a.e.occurredAt.dayIndex ||
        (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0),
    );

  const result: CourtEvent[] = [];
  if (pinned) result.push(pinned);
  for (const { e } of scored) {
    if (result.length >= limit) break;
    result.push(e);
  }
  return result;
}

// ── buildMemoryContext ────────────────────────────────────────────────────────

export interface BuildMemoryContextOpts {
  /** How many events to select for the prompt (default 3). */
  topEvents?: number;
}

export function buildMemoryContext(
  state: GameState,
  query: RecallQuery,
  ctx: ActivationContext,
  topN = 5,
  opts?: BuildMemoryContextOpts,
): DialogueMemoryContext {
  const topEvents = opts?.topEvents ?? 3;

  const recalled = recallCandidates(state, query);
  // Memories and events have INDEPENDENT quotas (P1): rank memories on their own so a
  // relevant memory is never crowded out of its topN slot by higher-scoring events,
  // which already get their own prompt quota via selectPromptEventsByActivation below.
  const rankedMemories = rankCandidates(state, ctx, { memories: recalled.memories, events: [] }, topN);

  // All known events, no quota
  const knownEventsAll = recallKnownEvents(state, query.speakerId);

  // Quota'd events for prompt, ranked by unified activation (PR-A item 9) so the
  // selection agrees with the orchestrator's pinned selection rather than diverging
  // on a separate publicSalience scan.
  const knownEvents = selectPromptEventsByActivation({ state, events: knownEventsAll, ctx, limit: topEvents });

  return {
    activatedMemories: rankedMemories.flatMap((c) => (c.kind === "memory" ? [c.memory] : [])),
    knownEvents,
    knownEventsAll,
  };
}
