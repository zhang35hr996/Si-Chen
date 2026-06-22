/**
 * Claim 装配 T6: ContextRef + AuthorizedClaim 组装管线。
 *
 * isLatestFactMutation — 给定 chronicle，检查某事件是否是影响同一「谓词×主体」
 *   的最新一条（按 occurredAt.dayIndex desc, id desc 排序）。
 *
 * eventToAuthorizedClaims — 从单个 CourtEvent 派生 AuthorizedClaim[]：
 *   - 双重校验：state 地面真相 + isLatestFactMutation
 *   - 仅处理白名单事件类型
 *
 * assembleClaims — 接收 offeredEvents（prompt 窗口内的事件）和 offeredMemories，
 *   生成本轮 allowed/forbidden claim 集合。
 *   - 按 authorizedClaimAggKey 聚合（不跨极性合并）
 *   - memory→event 链：仅当 memory.sourceEventId 对应的事件在 offeredEvents 中
 *   - sourceRefs 为空时排除 claim
 *   - forbiddenClaims: [] (T7 填充)
 */
import type { BeliefProjection } from "../chronicle/belief";
import type { GameState, CourtEvent, MemoryEntry } from "../state/types";
import type { DialogueAudienceContext } from "./audience";
import type { DialogueClaim } from "./claims";
import type { BuiltReaction } from "./reactionAssembler";
import {
  contextRefKey,
  authorizedClaimAggKey,
  MODALITY_STRENGTH,
  type AuthorizedClaim,
  type ContextRef,
} from "./types";

// ── Re-export AssembledClaims (updated shape) ────────────────────────────────

export interface AssembledClaims {
  allowed: AuthorizedClaim[];
  forbidden: DialogueClaim[];
}

// ── Predicate × subjectId identity for each event type ───────────────────────

interface FactIdentity {
  predicate: "holds_rank" | "resides_at" | "alive";
  subjectId: string;
}

/**
 * Extract the (predicate, subjectId) identity a CourtEvent mutates, for use in
 * `isLatestFactMutation`. Returns undefined for non-whitelisted event types or
 * when required participants/payload are absent.
 */
function eventFactIdentity(event: CourtEvent): FactIdentity | undefined {
  const findRole = (role: string): string | undefined =>
    event.participants.find((p) => p.role === role)?.charId;

  switch (event.type) {
    case "rank_changed": {
      const subjectId = findRole("subject");
      if (!subjectId) return undefined;
      return { predicate: "holds_rank", subjectId };
    }
    case "residence_changed": {
      const subjectId = findRole("mover");
      if (!subjectId) return undefined;
      return { predicate: "resides_at", subjectId };
    }
    case "heir_born":
    case "heir_died": {
      const heirId = event.payload["heirId"];
      if (typeof heirId !== "string" || !heirId) return undefined;
      return { predicate: "alive", subjectId: heirId };
    }
    default:
      return undefined;
  }
}

// ── isLatestFactMutation ──────────────────────────────────────────────────────

/**
 * Returns true if `event` is the most-recent mutation of its (predicate × subjectId)
 * fact in `chronicle`.
 *
 * Sort order: occurredAt.dayIndex desc, then id desc (lexicographic — "evt_000002" > "evt_000001").
 * The event with the highest sort key is the latest; all others return false.
 *
 * Events whose type is not whitelisted (no FactIdentity) always return false.
 */
export function isLatestFactMutation(
  event: CourtEvent,
  chronicle: readonly CourtEvent[],
): boolean {
  const identity = eventFactIdentity(event);
  if (!identity) return false;

  const { predicate, subjectId } = identity;

  // Collect all chronicle events that mutate the same fact identity
  const related = chronicle.filter((e) => {
    const fi = eventFactIdentity(e);
    return fi !== undefined && fi.predicate === predicate && fi.subjectId === subjectId;
  });

  if (related.length === 0) return false;

  // Sort: dayIndex desc, id desc
  const sorted = [...related].sort((a, b) => {
    const dayDiff = b.occurredAt.dayIndex - a.occurredAt.dayIndex;
    if (dayDiff !== 0) return dayDiff;
    // id desc (lexicographic)
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });

  return sorted[0]!.id === event.id;
}

// ── eventToAuthorizedClaims ───────────────────────────────────────────────────

/**
 * Derive AuthorizedClaim[] from a single CourtEvent.
 *
 * Double validation:
 *   1. State ground-truth check (the event's conclusion still holds in current state)
 *   2. isLatestFactMutation (this event is not superseded by a newer one)
 *
 * Event type → claim table:
 *   rank_changed      : holds_rank(subject, payload.to) assert — if state.standing[subject]?.rank === payload.to
 *   residence_changed : resides_at(mover, payload.to) assert — if state.standing[mover]?.residence === payload.to
 *   heir_born         : alive(heirId) assert (no object) — if heir.lifecycle === "alive"
 *   heir_died         : alive(heirId) deny (no object) — if heir.lifecycle !== "alive"
 *
 * `alive` claims intentionally omit the `object` field (per spec).
 *
 * Claim id format: `event:${event.id}:${predicate}:${subjectId}:${polarity}`
 *
 * Returns [] when:
 *   - event type is not whitelisted
 *   - required participants/payload absent
 *   - state check fails
 *   - isLatestFactMutation returns false
 */
export function eventToAuthorizedClaims(
  event: CourtEvent,
  state: GameState,
  sourceRef: ContextRef,
  chronicle: readonly CourtEvent[],
): AuthorizedClaim[] {
  const findRole = (role: string): string | undefined =>
    event.participants.find((p) => p.role === role)?.charId;

  switch (event.type) {
    case "rank_changed": {
      const subjectId = findRole("subject");
      if (!subjectId) return [];
      const payloadTo = event.payload["to"];
      if (typeof payloadTo !== "string" || !payloadTo) return [];
      // State check: subject's current rank must match payload.to
      if (state.standing[subjectId]?.rank !== payloadTo) return [];
      // Latest mutation check
      if (!isLatestFactMutation(event, chronicle)) return [];
      const claim: DialogueClaim = {
        id: `event:${event.id}:holds_rank:${subjectId}:affirm`,
        predicate: "holds_rank",
        subjectId,
        object: payloadTo,
        modality: "assert",
      };
      return [{ claim, sourceRefs: [sourceRef] }];
    }

    case "residence_changed": {
      const subjectId = findRole("mover");
      if (!subjectId) return [];
      const payloadTo = event.payload["to"];
      if (typeof payloadTo !== "string" || !payloadTo) return [];
      // State check: mover's current residence must match payload.to
      if (state.standing[subjectId]?.residence !== payloadTo) return [];
      // Latest mutation check
      if (!isLatestFactMutation(event, chronicle)) return [];
      const claim: DialogueClaim = {
        id: `event:${event.id}:resides_at:${subjectId}:affirm`,
        predicate: "resides_at",
        subjectId,
        object: payloadTo,
        modality: "assert",
      };
      return [{ claim, sourceRefs: [sourceRef] }];
    }

    case "heir_born": {
      const heirId = event.payload["heirId"];
      if (typeof heirId !== "string" || !heirId) return [];
      const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
      if (!heir) return [];
      // State check: heir must currently be alive
      if (heir.lifecycle !== "alive") return [];
      // Latest mutation check
      if (!isLatestFactMutation(event, chronicle)) return [];
      // alive claim: NO object field
      const claim: DialogueClaim = {
        id: `event:${event.id}:alive:${heirId}:affirm`,
        predicate: "alive",
        subjectId: heirId,
        modality: "assert",
      };
      return [{ claim, sourceRefs: [sourceRef] }];
    }

    case "heir_died": {
      const heirId = event.payload["heirId"];
      if (typeof heirId !== "string" || !heirId) return [];
      const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
      if (!heir) return [];
      // State check: heir must currently NOT be alive (deceased)
      if (heir.lifecycle === "alive") return [];
      // Latest mutation check
      if (!isLatestFactMutation(event, chronicle)) return [];
      // alive deny: NO object field
      const claim: DialogueClaim = {
        id: `event:${event.id}:alive:${heirId}:deny`,
        predicate: "alive",
        subjectId: heirId,
        modality: "deny",
      };
      return [{ claim, sourceRefs: [sourceRef] }];
    }

    // Non-whitelisted types: no fact claims
    case "punished":
    case "rewarded":
    case "conflict":
    case "promise":
    case "secret_discovered":
      return [];

    default: {
      const _exhaustive: never = event.type;
      void _exhaustive;
      return [];
    }
  }
}

// ── assembleClaims ────────────────────────────────────────────────────────────

/**
 * Assemble the authorized/forbidden claim sets for this dialogue turn.
 *
 * Sources:
 *   - offeredEvents: CourtEvents in the prompt window (NOT knownEventsAll).
 *     Each event generates claims via eventToAuthorizedClaims.
 *   - offeredMemories: memories offered to the LLM. For memories with
 *     sourceEventId, the memory co-authorizes the claim IF AND ONLY IF its
 *     sourceEventId matches an event already in offeredEvents.
 *   - builtReaction: if defined, its sourceEventId event is already in
 *     offeredEvents (pinned there by the pipeline). No special handling needed —
 *     events are the canonical source.
 *
 * Aggregation:
 *   - Key = authorizedClaimAggKey (fact + polarity) — opposite-polarity claims
 *     for the same fact are NEVER merged.
 *   - When multiple sources yield the same (fact, polarity), sourceRefs union and
 *     the highest-strength modality wins.
 *   - Claims with empty sourceRefs are excluded from output.
 *
 * forbiddenClaims: empty for now (T7 will populate from belief contradictions).
 */
export function assembleClaims(args: {
  speakerId: string;
  builtReaction: BuiltReaction | undefined;
  offeredMemories: readonly MemoryEntry[];
  offeredEvents: readonly CourtEvent[];
  beliefs: BeliefProjection;
  state: GameState;
  audience: DialogueAudienceContext;
}): AssembledClaims {
  const { offeredMemories, offeredEvents, state } = args;

  // Build a fast lookup: eventId → CourtEvent (for the offered window)
  const offeredEventById = new Map<string, CourtEvent>(
    offeredEvents.map((e) => [e.id, e]),
  );

  // Aggregation map: aggKey → { claim, sourceRefKeys (deduped), modality strength }
  const agg = new Map<string, {
    claim: DialogueClaim;
    refSet: Set<string>;           // deduplicated by contextRefKey
    refs: ContextRef[];
    strength: number;
  }>();

  /**
   * Merge a candidate AuthorizedClaim into the aggregation map.
   * - Same aggKey: union sourceRefs, upgrade modality if stronger.
   * - New aggKey: insert directly.
   */
  function merge(candidate: AuthorizedClaim): void {
    const key = authorizedClaimAggKey(candidate.claim);
    const existing = agg.get(key);
    if (!existing) {
      agg.set(key, {
        claim: candidate.claim,
        refSet: new Set(candidate.sourceRefs.map(contextRefKey)),
        refs: [...candidate.sourceRefs],
        strength: MODALITY_STRENGTH[candidate.claim.modality] ?? -1,
      });
    } else {
      // Union sourceRefs (deduplicate)
      for (const ref of candidate.sourceRefs) {
        const rk = contextRefKey(ref);
        if (!existing.refSet.has(rk)) {
          existing.refSet.add(rk);
          existing.refs.push(ref);
        }
      }
      // Upgrade to stronger modality if applicable
      const candidateStrength = MODALITY_STRENGTH[candidate.claim.modality] ?? -1;
      if (candidateStrength > existing.strength) {
        existing.strength = candidateStrength;
        // Replace claim with stronger-modality version (keep same sourceRefs)
        existing.claim = candidate.claim;
      }
    }
  }

  // 1. Generate claims from offeredEvents directly
  for (const event of offeredEvents) {
    const eventRef: ContextRef = { kind: "event", id: event.id };
    const candidates = eventToAuthorizedClaims(event, state, eventRef, state.chronicle);
    for (const candidate of candidates) {
      merge(candidate);
    }
  }

  // 2. Memory→event chain: memories co-authorize claims when their sourceEventId
  //    is present in offeredEvents. Only memories WITH sourceEventId participate.
  //    Memories without sourceEventId generate no fact claims.
  for (const memory of offeredMemories) {
    if (!memory.sourceEventId) continue;
    const sourceEvent = offeredEventById.get(memory.sourceEventId);
    if (!sourceEvent) continue; // sourceEventId event not in offered window — skip

    const memoryRef: ContextRef = { kind: "memory", id: memory.id };
    // eventToAuthorizedClaims validates state + isLatestFactMutation; pass through
    const candidates = eventToAuthorizedClaims(sourceEvent, state, memoryRef, state.chronicle);
    for (const candidate of candidates) {
      merge(candidate);
    }
  }

  // 3. Collect results — exclude any claim that ends up with no sourceRefs
  const allowed: AuthorizedClaim[] = [];
  for (const { claim, refs } of agg.values()) {
    if (refs.length === 0) continue;
    allowed.push({ claim, sourceRefs: refs });
  }

  // forbiddenClaims: empty — T7 will derive these from belief contradictions
  return { allowed, forbidden: [] };
}
