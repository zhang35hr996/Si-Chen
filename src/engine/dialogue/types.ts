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

// ── §0 Core claim-authorization types (T6) ───────────────────────────────────

import type { DialogueClaim, ClaimModality } from "./claims";

/**
 * A typed reference to a context item offered to the LLM in this turn.
 * `kind` + `id` uniquely identify the source.
 */
export interface ContextRef {
  kind: "memory" | "event" | "fact";
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
  sceneDirective?: string;
  transcript: { speaker: string; text: string }[];
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
}

export interface DialogueGenerationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface DialogueProvider {
  readonly id: string;
  /** scripted providers echo authored content; generative ones invent it. */
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;
  generate(request: DialogueRequest, options?: DialogueGenerationOptions): Promise<ProviderResult<DialogueProviderResult>>;
}

/** What the UI renders — it never sees scene nodes. */
export interface DialogueLine {
  speakerId: string;
  speakerName: string;
  text: string;
  /** Resolved against the character's expression list (neutral fallback). */
  expression: string;
  choices: { id: string; text: string; tone?: string }[];
  meta: { generated: boolean; degraded: boolean };
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
}

// Re-export ProposedClaim so callers can import from types without reaching into claims
export type { ProposedClaim };

// ── Validation pipeline types (T3: validateDialogueProviderResult) ────────────

import type { ClaimGateFinding } from "./claimGate";
import type { GateFinding } from "./gates";

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
}

/**
 * Return shape of validateDialogueProviderResult.
 * Always carries diagnostics — T4 eval runner reads them even on ok=false.
 */
export type DialogueValidationOutcome =
  | { ok: true;  line: DialogueLine; diagnostics: DialogueValidationDiagnostics }
  | { ok: false; error: import("../infra/errors").GameError; diagnostics: DialogueValidationDiagnostics };
