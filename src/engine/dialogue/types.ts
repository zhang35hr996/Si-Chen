/**
 * Dialogue seam (skeleton-plan §8). The DialogueRequest already carries every
 * field the future AI needs (profile, voice, standing+selfRefs,
 * memories, etiquette); MockProvider ignores most of it and echoes authored
 * lines — but the seam is exercised on every single line from day one.
 */
import type { GameTime } from "../calendar/time";
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { BeliefProjection } from "../chronicle/belief";
import type { CharacterStanding, MemoryEntry } from "../state/types";
import type { ProposedClaim } from "./claims";
import type { DialogueAudienceContext } from "./audience";
import type { ReactionPlan } from "./reactionTypes";
import type { DialogueProviderResult, ProviderResult, ProviderCapabilities } from "./providerContract";
import type { DialoguePromptContext } from "./promptPayload";
import type { PairwiseAddress } from "./addressResolver";

// ── §0 Core claim-authorization types (T6) ───────────────────────────────────

import type { DialogueClaim, ClaimModality } from "./claims";

/**
 * Scene register: the formality and privacy level of the conversation.
 * Used by the conditional-term gate (e.g. 凤君 is only permitted in
 * private / intimate registers for authorized speakers).
 *
 *   court    — formal court audience, ceremony, or official proceeding
 *   public   — shared / semi-public space with observers
 *   private  — private chamber / inner-quarters conversation
 *   intimate — one-on-one in a wholly private setting, maximum trust
 */
export type SceneRegister = "court" | "public" | "private" | "intimate";

/**
 * A typed reference to a context item offered to the LLM in this turn.
 * `kind` + `id` uniquely identify the source.
 * "knowledge" refs may appear in mentionedContextRefs but NEVER in claim sourceRefs.
 */
export interface ContextRef {
  kind: "memory" | "event" | "fact" | "knowledge";
  id: string;
}

/** Canonical string key for a ContextRef (used as a Set/Map key). */
export function contextRefKey(r: ContextRef): string {
  return `${r.kind}:${r.id}`;
}

/**
 * Canonical key for the fact a DialogueClaim asserts/denies.
 * Two claims with equal `claimFactKey` are about the same fact — polarity
 * and modality may differ.
 * `alive` claims have no `object`, so `object ?? null` → null.
 */
export function claimFactKey(c: Pick<DialogueClaim, "predicate" | "subjectId" | "object">): string {
  return JSON.stringify([c.predicate, c.subjectId, c.object ?? null]);
}

/** Simplified polarity axis: affirm or deny. */
export type ClaimPolarity = "affirm" | "deny";

/** Maps a ClaimModality to its ClaimPolarity. Only "deny" maps to "deny"; all others affirm. */
export function claimPolarity(m: ClaimModality): ClaimPolarity {
  return m === "deny" ? "deny" : "affirm";
}

/**
 * Ordinal strength of claim modalities for aggregation tie-breaking.
 * `rumor` (0) < `suspect` (1) < `assert` (2).
 * `deny` is intentionally absent — it has a separate polarity and cannot be
 * merged with affirm-polarity claims.
 */
export const MODALITY_STRENGTH: Partial<Record<ClaimModality, number>> = {
  rumor: 0,
  suspect: 1,
  assert: 2,
};

/**
 * Aggregation key that combines fact identity AND polarity.
 * Opposite-polarity claims for the same fact must NEVER merge.
 */
export function authorizedClaimAggKey(c: Pick<DialogueClaim, "predicate" | "subjectId" | "object" | "modality">): string {
  return `${claimFactKey(c)}:${claimPolarity(c.modality)}`;
}

/**
 * A claim the speaker is authorized to make in this turn, with its provenance
 * (sourceRefs is always non-empty — no sources = not authorized).
 */
export interface AuthorizedClaim {
  claim: DialogueClaim;
  /** Non-empty: each ref is a context item offered to the LLM that justifies this claim. */
  sourceRefs: ContextRef[];
}

export interface DialogueRequest {
  speakerId: string;
  targetId: string; // usually "player"
  locationId: string;
  time: GameTime; // never CalendarState — a speaker doesn't know the player's AP
  /**
   * Scene register: formality + privacy level. Drives conditional-term gate.
   * Defaults to "private" in assembleDialogueRequest when not explicitly provided.
   */
  register: SceneRegister;
  speakerContext: {
    profile: CharacterContent["profile"];
    voice: CharacterContent["voice"];
    standing: CharacterStanding & { selfRefs: CharacterRank["selfRefs"] };
    /** 由激活管线填充（decay → retrievalScore → rankCandidates，默认 topN 5）。 */
    relevantMemories: MemoryEntry[];
    stances: { charId: string; attitude: string }[];
  };
  etiquette: {
    allowedTerms: string[];
    forbiddenTerms: string[];
    addressRules: { rank: string; selfRefs: CharacterRank["selfRefs"]; addressedAs: string }[];
  };
  /**
   * Pre-computed pairwise address result for this specific conversation.
   * Fulfills docs/world/45-address-and-title-system.md runtime requirement.
   * Optional for backwards compatibility with manual test fixtures; always
   * populated by assembleDialogueRequest.
   */
  resolvedAddress?: PairwiseAddress;
  sceneDirective?: string;
  transcript: { speaker: string; text: string }[];
  /** Topic tags for the current beat — surfaced to the LLM as currentScene.topicTags. */
  topicTags: string[];
  /** Present for scripted nodes: the authored line the mock provider echoes. */
  scripted?: { text: string; expression?: string };
  /** LLM-2 prompt compiler boundary: structured context for the LLM. */
  promptContext: DialoguePromptContext;
}

/**
 * Options for assembleDialogueRequest (LLM-2 §1).
 * Lives in types.ts (not promptPayload.ts) so orchestrator does not depend on
 * the DTO module for its function signature.
 */
export interface DialogueAssemblyOptions {
  targetId?: string;                           // defaults to "player"
  sceneDirective?: string;
  transcript?: { speaker: string; text: string }[];  // defaults to []
  scripted?: { text: string; expression?: string };
  /** Topic tags for the current beat — drives recall, activation, and the prompt. */
  topicTags?: string[];
  /** Who the beat is actually about — drives recall + activation. Defaults to [speakerId]. */
  subjectIds?: string[];
  /** Who else is physically present — drives recall, activation, and audience. */
  presentCharacterIds?: string[];
  /** Scene privacy — drives audience gating. Defaults to "semi_private". */
  privacy?: "public" | "semi_private" | "private";
  /**
   * Scene register: drives conditional-term gate (e.g. 凤君 requires private/intimate).
   * Defaults to "private" — most harem dialogue is private inner-quarters conversation.
   * Callers should pass "court" or "public" for formal scenes.
   */
  register?: SceneRegister;
}

export interface DialogueGenerationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
}

/**
 * Options for produceDialogueTurn — replaces the former positional `logger?` param.
 */
export interface DialogueTurnOptions {
  logger?: import("../infra/logger").RingBufferLogger;
  /** When provided, performs knowledge retrieval and injects results into the prompt. */
  retriever?: import("./knowledge/types").KnowledgeRetriever;
  /**
   * Controls behaviour when the retriever throws a fatal error.
   *
   * - `"continue_without_knowledge"` (default): provider call proceeds with
   *   `knowledgeContext: []`. The returned `meta.knowledge` records the failure
   *   as degraded. The error text is never sent to the LLM.
   * - `"fail_turn"`: provider is NOT called. `produceDialogueTurn` returns an
   *   error. State remains unchanged (reference-equal to the input state).
   */
  knowledgeFailureMode?: "continue_without_knowledge" | "fail_turn";
}

export interface DialogueProvider {
  readonly id: string;
  /** scripted providers echo authored content; generative ones invent it. */
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;
  generate(request: DialogueRequest, options?: DialogueGenerationOptions): Promise<ProviderResult<DialogueProviderResult>>;
}

/**
 * Discriminated union representing the outcome of knowledge retrieval for a turn.
 * Passed from the retrieval block into extractProvenance so the diagnostic is
 * derived from the actual outcome, never inferred from the packed-chunk count.
 *
 * - `not_configured`: no retriever was provided → no knowledge context
 * - `ok`:            retrieval succeeded (may have zero hits — that is NOT degraded)
 * - `vector_degraded`: keyword fallback active; exact reason preserved
 * - `fatal_degraded`:  retriever threw; turn continues (continue_without_knowledge)
 */
export type KnowledgeRetrievalStatus =
  | { readonly kind: "not_configured" }
  | { readonly kind: "ok" }
  | { readonly kind: "vector_degraded"; readonly reason: import("../knowledge/retrieval/types").VectorDegradation["reason"] }
  | { readonly kind: "fatal_degraded" }
  /** Retriever was configured but query was classified as runtime_state — retrieval intentionally skipped. */
  | { readonly kind: "skipped_runtime_state" };

/** What the UI renders — it never sees scene nodes. */
export interface DialogueLine {
  speakerId: string;
  speakerName: string;
  text: string;
  /** Resolved against the character's expression list (neutral fallback). */
  expression: string;
  choices: { id: string; text: string; tone?: string }[];
  meta: {
    generated: boolean;
    degraded: boolean;
    /** All context refs (memory/event/knowledge kinds) the model drew on this turn. */
    sourceRefs?: ContextRef[];
    /**
     * Knowledge retrieval diagnostic. Present when a retriever was wired.
     * `degraded` is true only for vector_degraded and fatal_degraded status.
     * Successful empty retrieval (status: "ok") sets degraded: false.
     */
    knowledge?: {
      chunkIds: string[];
      degraded: boolean;
      /** Machine-readable degradation class. Absent when status is "ok". */
      degradationKind?: "vector_degraded" | "fatal_degraded";
      /** Specific reason from the vector channel failure. Absent when not vector_degraded. */
      degradationReason?: import("../knowledge/retrieval/types").VectorDegradation["reason"];
    };
  };
}

export interface DialoguePolicyContext {
  audience: DialogueAudienceContext;
  reactionPlan?: ReactionPlan;
  beliefProjection: BeliefProjection;
  /** Keys produced by `contextRefKey()` for every ref actually sent to the LLM. */
  offeredRefKeys: ReadonlySet<string>;
  now: GameTime;
  /** Claims the speaker is authorized to make this turn (populated in T6+). */
  allowedClaims: readonly AuthorizedClaim[];
  /** Claims the speaker must not make this turn. */
  forbiddenClaims: readonly DialogueClaim[];
  /** Outcome of knowledge retrieval for this turn. Absent when no retriever was wired. */
  knowledgeRetrievalStatus?: KnowledgeRetrievalStatus;
}

// Re-export ProposedClaim so callers can import from types without reaching into claims
export type { ProposedClaim };

// ── Validation pipeline types (T3: validateDialogueProviderResult) ────────────

import type { ClaimGateFinding } from "./claimGate";
import type { GateFinding } from "./gates";

/**
 * A single provenance finding: a context ref returned by the model that was
 * not in the offered ref set (hallucinated, stale, or out-of-scope).
 * These refs are excluded from `DialogueLine.meta.sourceRefs`.
 */
export interface ProvenanceFinding {
  code: "unknown_context_ref";
  ref: ContextRef;
}

/**
 * Structured findings gathered during the shared validation pipeline.
 * Always present on DialogueValidationOutcome — even ok=false paths fill in
 * whatever was gathered before the first failure.
 */
export interface DialogueValidationDiagnostics {
  /** Claim gate findings (all findings, including rejected ones). */
  claimFindings: ClaimGateFinding[];
  /** Text gate findings (all findings, including rejected ones). */
  textFindings: GateFinding[];
  /** Claims accepted by the claim gate (empty on claim-gate failure). */
  acceptedClaims: import("./claims").ProposedClaim[];
  /** Context refs returned by the model that were not offered in this turn. */
  provenanceFindings: ProvenanceFinding[];
}

/**
 * Return shape of validateDialogueProviderResult.
 * Always carries diagnostics — T4 eval runner reads them even on ok=false.
 */
export type DialogueValidationOutcome =
  | { ok: true;  line: DialogueLine; diagnostics: DialogueValidationDiagnostics }
  | { ok: false; error: import("../infra/errors").GameError; diagnostics: DialogueValidationDiagnostics };
