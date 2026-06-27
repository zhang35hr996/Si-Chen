/**
 * DTO layer between the game engine and the LLM prompt compiler (LLM-2 §1).
 * These types carry only the fields the LLM needs — internal engine fields
 * (ownerId, strength, retention, triggerTags) are deliberately excluded so
 * the compiler boundary stays clean.
 */
import type { GameTime } from "../calendar/time";
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { ContentDB } from "../content/loader";
import type { MemoryEntry, MemoryKind, MemoryPerspective, MemoryEmotion, CourtEventType, CourtEvent } from "../state/types";
import type { GameState } from "../state/types";
import type { ConsortRuntimeAttrs } from "../characters/consortAttrs";
import type { ReactionPlan } from "./reactionTypes";
import type { DialogueAudienceContext } from "./audience";
import type { DialogueClaim } from "./claims";
import type { AuthorizedClaim } from "./types";
import type { DialogueRequest } from "./types";
import type { PromptKnowledgeChunk } from "./knowledge/types";

// ── Scalar value type for structured facts ────────────────────────────────────

export type PromptFactValue = string | number | boolean | null;

// ── PromptMemory: stripped-down MemoryEntry for the LLM ──────────────────────

/** Memory as seen by the LLM prompt — no ownerId, strength, retention, triggerTags. */
export interface PromptMemory {
  id: string;
  kind: MemoryKind;
  summary: string;
  subjectIds: string[];
  perspective: MemoryPerspective;
  emotions: Partial<Record<MemoryEmotion, number>>;
  unresolved: boolean;
  createdAt: GameTime;   // maps from m.createdAt (NOT occurredAt)
}

// ── PromptEventParticipant: participant enriched with display name ────────────

/** Court event participant as seen by the LLM prompt — adds displayName resolved from game state. */
export interface PromptEventParticipant {
  charId: string;
  role: string;
  displayName: string;
}

// ── PromptEvent: stripped-down CourtEvent for the LLM ────────────────────────

/** Court event as seen by the LLM prompt — no publicity, publicSalience, retention, tags. */
export interface PromptEvent {
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: PromptEventParticipant[];
  locationId?: string;
  facts: Record<string, PromptFactValue>;
}

// ── DialogueChoiceCandidate ───────────────────────────────────────────────────

export interface DialogueChoiceCandidate {
  id: string;
  intent: string;
}

// ── DialogueSpeakerStanding: discriminated union for rank display ─────────────

export type DialogueSpeakerStanding =
  | { kind: "ranked"; id: string; name: string; grade: string; selfRefs: CharacterRank["selfRefs"] }
  | { kind: "unranked"; role: string; selfRefs: CharacterRank["selfRefs"] };

// ── DialoguePromptContext: the full context handed to the LLM ────────────────

export interface DialoguePromptContext {
  speakerDisplayName: string;
  rankDisplay: DialogueSpeakerStanding;
  audience: DialogueAudienceContext;
  relevantMemories: PromptMemory[];
  reactionPlan?: ReactionPlan;                    // undefined until LLM-3
  knownEvents: PromptEvent[];                     // [] until LLM-3
  allowedClaims: readonly AuthorizedClaim[];      // [] until T6
  forbiddenClaims: readonly DialogueClaim[];
  /** The event id that triggered the speaker's reactionPlan, if any (populated in T6+). */
  reactionSourceEventId?: string;
  choiceCandidates: DialogueChoiceCandidate[];    // [] until LLM-2
  /** Resolved runtime attributes.  Only present for consorts. */
  behavioralState?: ConsortRuntimeAttrs;
  /** Advisory world-knowledge chunks. Present only when a retriever is wired (PR3+). */
  knowledgeContext?: PromptKnowledgeChunk[];
}

// Re-export so callers can import PromptKnowledgeChunk from promptPayload
export type { PromptKnowledgeChunk };

// ── Conversion helper ─────────────────────────────────────────────────────────

/** Strip engine-internal fields from a MemoryEntry to produce a PromptMemory. */
export function toPromptMemory(m: MemoryEntry): PromptMemory {
  return {
    id: m.id,
    kind: m.kind,
    summary: m.summary,
    subjectIds: m.subjectIds,
    perspective: m.perspective,
    emotions: m.emotions,
    unresolved: m.unresolved,
    createdAt: m.createdAt,
  };
}

// ── DialogueSpeakerPayload ────────────────────────────────────────────────────

export interface DialogueSpeakerPayload {
  id: string;
  name: string;
  standing: DialogueSpeakerStanding;
  speechStyle: string;
  personalityTraits: string[];
  coreFacts: string[];
  voice: CharacterContent["voice"];
  /**
   * Resolved runtime attributes.  Influences tone and emotional register only.
   * The LLM must NOT state these as numeric facts, must NOT modify them, and
   * must NOT treat them as public knowledge the character would announce.
   */
  behavioralState?: ConsortRuntimeAttrs;
}

// ── DialoguePromptPayload ─────────────────────────────────────────────────────

export interface DialoguePromptPayload {
  speaker: DialogueSpeakerPayload;
  audience: DialogueAudienceContext;
  reactionPlan?: ReactionPlan;
  /** The event id that triggered the reactionPlan, if any. */
  reactionSourceEventId?: string;
  relevantMemories: PromptMemory[];
  knownEvents: PromptEvent[];
  allowedClaims: readonly AuthorizedClaim[];
  forbiddenClaims: readonly DialogueClaim[];
  choiceCandidates: DialogueChoiceCandidate[];
  /** Advisory world-knowledge chunks. Present only when a retriever is wired (PR3+). */
  knowledgeContext?: PromptKnowledgeChunk[];
  currentScene: {
    location: string;
    directive?: string;             // present only when request.sceneDirective is set
    topicTags: string[];
    recentLines: { speaker: string; text: string }[];
  };
}

// ── resolvePromptEntityName ───────────────────────────────────────────────────

/**
 * Resolve a game-world entity id to its human-readable display name.
 * Resolution order (|| not ??, so empty-string falls through):
 *   "player" → "陛下"
 *   db.characters[id] → profile.name
 *   state.generatedConsorts?.[id] → profile.name
 *   bloodline.heirs[id] → givenName || petName || "皇嗣"
 *   state.officials?.[id] → surname + givenName
 *   fallback → "某人"
 */
export function resolvePromptEntityName(id: string, db: ContentDB, state: GameState): string {
  if (id === "player") return "陛下";
  const char = db.characters[id];
  if (char) return char.profile.name;
  const consort = state.generatedConsorts?.[id];
  if (consort) return consort.profile.name;
  const heir = state.resources.bloodline.heirs.find((h) => h.id === id);
  if (heir) return heir.givenName || heir.petName || "皇嗣";
  const official = state.officials?.[id];
  if (official) return `${official.surname}${official.givenName}`;
  return "某人";
}

// ── toPromptEvent ─────────────────────────────────────────────────────────────

/** Whether a value is safe to include in LLM facts (no NaN or Infinity). */
function isSafeFactValue(v: unknown): v is PromptFactValue {
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return false;
}

/**
 * Convert a CourtEvent to a PromptEvent:
 * - Strips: publicity, publicSalience, retention, tags (internal engine fields)
 * - Enriches participants with displayName via resolvePromptEntityName
 * - Whitelists and transforms payload fields per event type:
 *     rank_changed      → { from, to } (rank id → display name), direction (string)
 *     residence_changed → { from, to } (location id → display name)
 *     heir_born         → { heirId } (string scalar)
 *     heir_died         → { heirId } (string scalar)
 *     all others        → facts: {}
 * - Excludes NaN/Infinity values from facts
 */
export function toPromptEvent(e: CourtEvent, db: ContentDB, state: GameState): PromptEvent {
  const participants: PromptEventParticipant[] = e.participants.map((p) => ({
    charId: p.charId,
    role: p.role,
    displayName: resolvePromptEntityName(p.charId, db, state),
  }));

  let facts: Record<string, PromptFactValue> = {};

  if (e.type === "rank_changed") {
    const from = typeof e.payload["from"] === "string" ? e.payload["from"] : undefined;
    const to = typeof e.payload["to"] === "string" ? e.payload["to"] : undefined;
    const direction = e.payload["direction"];
    facts = {
      from: from !== undefined ? (db.ranks[from]?.name ?? "某位分") : "某位分",
      to: to !== undefined ? (db.ranks[to]?.name ?? "某位分") : "某位分",
      ...(isSafeFactValue(direction) ? { direction } : {}),
    };
  } else if (e.type === "residence_changed") {
    const from = typeof e.payload["from"] === "string" ? e.payload["from"] : undefined;
    const to = typeof e.payload["to"] === "string" ? e.payload["to"] : undefined;
    facts = {
      from: from !== undefined ? (db.locations[from]?.name ?? "某处") : "某处",
      to: to !== undefined ? (db.locations[to]?.name ?? "某处") : "某处",
    };
  } else if (e.type === "heir_born" || e.type === "heir_died") {
    const heirId = e.payload["heirId"];
    if (isSafeFactValue(heirId)) {
      facts = { heirId };
    }
  }
  // All other types: facts = {} (already initialized)

  return {
    id: e.id,
    type: e.type,
    occurredAt: e.occurredAt,
    participants,
    ...(e.locationId !== undefined ? { locationId: e.locationId } : {}),
    facts,
  };
}

// ── compilePromptPayload ──────────────────────────────────────────────────────

/**
 * Pure compiler: assembles a DialoguePromptPayload from a DialogueRequest.
 * No GameState or ContentDB references — all data comes from request.promptContext
 * and request.speakerContext.
 */
export function compilePromptPayload(request: DialogueRequest): DialoguePromptPayload {
  const ctx = request.promptContext;
  return {
    speaker: {
      id: request.speakerId,
      name: ctx.speakerDisplayName,
      standing: ctx.rankDisplay,
      speechStyle: request.speakerContext.profile.speechStyle,
      personalityTraits: request.speakerContext.profile.personalityTraits,
      coreFacts: request.speakerContext.profile.coreFacts,
      voice: request.speakerContext.voice,
      ...(ctx.behavioralState !== undefined ? { behavioralState: ctx.behavioralState } : {}),
    },
    audience: ctx.audience,
    reactionPlan: ctx.reactionPlan,
    ...(ctx.reactionSourceEventId !== undefined ? { reactionSourceEventId: ctx.reactionSourceEventId } : {}),
    relevantMemories: ctx.relevantMemories,
    knownEvents: ctx.knownEvents,
    allowedClaims: ctx.allowedClaims,
    forbiddenClaims: ctx.forbiddenClaims,
    choiceCandidates: ctx.choiceCandidates,
    ...(ctx.knowledgeContext !== undefined ? { knowledgeContext: ctx.knowledgeContext } : {}),
    currentScene: {
      location: request.locationId,
      ...(request.sceneDirective ? { directive: request.sceneDirective } : {}),
      topicTags: request.topicTags,
      recentLines: request.transcript.slice(-6),
    },
  };
}
