/**
 * DTO layer between the game engine and the LLM prompt compiler (LLM-2 §1).
 * These types carry only the fields the LLM needs — internal engine fields
 * (ownerId, strength, retention, triggerTags) are deliberately excluded so
 * the compiler boundary stays clean.
 */
import type { GameTime } from "../calendar/time";
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { MemoryEntry, MemoryKind, MemoryPerspective, MemoryEmotion, CourtEventType, CourtEventParticipant } from "../state/types";
import type { ReactionPlan } from "./reactionTypes";
import type { DialogueAudienceContext } from "./audience";
import type { DialogueClaim } from "./claims";
import type { DialogueRequest } from "./types";

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

// ── PromptEvent: stripped-down CourtEvent for the LLM ────────────────────────

/** Court event as seen by the LLM prompt — no publicity, publicSalience, retention, tags. */
export interface PromptEvent {
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];
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
  reactionPlan?: ReactionPlan;           // undefined until LLM-3
  knownEvents: PromptEvent[];            // [] until LLM-3
  allowedClaims: DialogueClaim[];        // [] until LLM-3
  forbiddenClaims: DialogueClaim[];      // [] until LLM-3
  choiceCandidates: DialogueChoiceCandidate[];  // [] until LLM-2
}

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
}

// ── DialoguePromptPayload ─────────────────────────────────────────────────────

export interface DialoguePromptPayload {
  speaker: DialogueSpeakerPayload;
  audience: DialogueAudienceContext;
  reactionPlan?: ReactionPlan;
  relevantMemories: PromptMemory[];
  knownEvents: PromptEvent[];
  allowedClaims: DialogueClaim[];
  forbiddenClaims: DialogueClaim[];
  choiceCandidates: DialogueChoiceCandidate[];
  currentScene: {
    location: string;
    directive?: string;             // present only when request.sceneDirective is set
    topicTags: string[];
    recentLines: { speaker: string; text: string }[];
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
    },
    audience: ctx.audience,
    reactionPlan: ctx.reactionPlan,
    relevantMemories: ctx.relevantMemories,
    knownEvents: ctx.knownEvents,
    allowedClaims: ctx.allowedClaims,
    forbiddenClaims: ctx.forbiddenClaims,
    choiceCandidates: ctx.choiceCandidates,
    currentScene: {
      location: request.locationId,
      ...(request.sceneDirective ? { directive: request.sceneDirective } : {}),
      topicTags: [],
      recentLines: request.transcript.slice(-6),
    },
  };
}
