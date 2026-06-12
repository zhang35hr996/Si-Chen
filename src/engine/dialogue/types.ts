/**
 * Dialogue seam (skeleton-plan §8). The DialogueRequest already carries every
 * field the future AI needs (profile, voice, relationship, standing+selfRefs,
 * memories, etiquette); MockProvider ignores most of it and echoes authored
 * lines — but the seam is exercised on every single line from day one.
 */
import { z } from "zod";
import type { GameTime } from "../calendar/time";
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { GameError } from "../infra/errors";
import type { Result } from "../infra/result";
import type { CharacterStanding, MemoryEntry, RelationshipState } from "../state/types";

export interface DialogueRequest {
  speakerId: string;
  targetId: string; // usually "player"
  locationId: string;
  time: GameTime; // never CalendarState — a speaker doesn't know the player's AP
  speakerContext: {
    profile: CharacterContent["profile"];
    voice: CharacterContent["voice"];
    relationship: RelationshipState;
    standing: CharacterStanding & { selfRefs: CharacterRank["selfRefs"] };
    /** v0: always [] — retrieval lands with the real provider (plan §7). */
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
}

/** Provider-shaped output; the orchestrator validates before anything renders. */
export const rawDialogueResponseSchema = z.strictObject({
  speaker: z.string().min(1),
  text: z.string().min(1).max(600),
  expression: z.string().min(1).optional(),
  choices: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        text: z.string().min(1).max(120),
        tone: z.enum(["friendly", "neutral", "guarded", "hostile", "flirty"]).optional(),
      }),
    )
    .max(4),
});
export type RawDialogueResponse = z.infer<typeof rawDialogueResponseSchema>;

export interface DialogueProvider {
  readonly id: string;
  /** scripted providers echo authored content; generative ones invent it. */
  readonly kind: "scripted" | "generative";
  generate(request: DialogueRequest): Promise<Result<RawDialogueResponse, GameError>>;
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
