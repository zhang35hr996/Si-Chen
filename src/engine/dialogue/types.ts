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
  offeredContextIds: ReadonlySet<string>;
  now: GameTime;
}

// Re-export ProposedClaim so callers can import from types without reaching into claims
export type { ProposedClaim };
