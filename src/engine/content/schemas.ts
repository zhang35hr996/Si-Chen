/**
 * Zod schemas for all content files (skeleton-plan §4). These are the single
 * runtime-validation source; content types are inferred (z.infer) so schema
 * and type cannot drift. All objects are strict: unknown keys are content
 * errors — this is also what makes the scaffold guard structural (§2 of the
 * plan): the condition DSL simply has no resource/bloodline predicates, so a
 * condition referencing one fails schema validation.
 *
 * All shipped content/** files are strict JSON (no comments, no trailing commas).
 */
import { z } from "zod";
import type { CharacterStanding, RelationshipState } from "../state/types";

// ── shared primitives ─────────────────────────────────────────────────
export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "ids are lowercase snake_case ascii");

const percent = z.number().int().min(0).max(100);
/** Content-declared deltas are bounded ±10 per effect (plan §6). */
const delta = z.number().int().min(-10).max(10);
const nonEmpty = z.string().min(1);

const tagSchema = z.string().regex(/^[a-z0-9_]+$/, "tags are lowercase ascii");
const participantSchema = z.union([z.literal("player"), idSchema]);

export const monthPeriodSchema = z.enum(["early", "mid", "late"]);

// ── per-character runtime fragments (bound to engine/state/types) ─────
export const relationshipStateSchema = z.strictObject({
  trust: percent,
  affinity: percent,
  flags: z.array(z.string()),
}) satisfies z.ZodType<RelationshipState>;

export const characterStandingSchema = z.strictObject({
  rank: idSchema,
  favor: percent,
}) satisfies z.ZodType<CharacterStanding>;

// ── memory drafts ─────────────────────────────────────────────────────
export const memoryKindSchema = z.enum([
  "event",
  "fact_learned",
  "opinion",
  "promise",
  "conversation_summary",
]);

const memoryDraftBase = z.strictObject({
  kind: memoryKindSchema,
  summary: z.string().min(1).max(240),
  salience: percent,
  tags: z.array(tagSchema).max(5),
  participants: z.array(participantSchema).min(1),
  locationId: idSchema.optional(),
});

/** Authored initial memories may be protected (default true — DESIGN §4.8). */
export const initialMemoryDraftSchema = memoryDraftBase.extend({
  protected: z.boolean().default(true),
});

/** In-scene memory effects can NEVER be protected (plan §6). */
export const effectMemoryDraftSchema = memoryDraftBase.extend({
  protected: z.literal(false).optional(),
});

export type InitialMemoryDraft = z.infer<typeof initialMemoryDraftSchema>;
export type EffectMemoryDraft = z.infer<typeof effectMemoryDraftSchema>;

// ── trigger condition DSL (closed set — plan §2 scaffold guard) ───────
export type TriggerCondition =
  | { all: TriggerCondition[] }
  | { any: TriggerCondition[] }
  | { not: TriggerCondition }
  | { flagSet: string }
  | { monthAtLeast: number }
  | { periodIs: "early" | "mid" | "late" }
  | { atLocation: string }
  | { relationshipAtLeast: { char: string; field: "trust" | "affinity"; value: number } }
  | { favorAtLeast: { char: string; value: number } }
  | { rankAtLeast: { char: string; rank: string } }
  | { eventFired: string };

export const triggerConditionSchema: z.ZodType<TriggerCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(triggerConditionSchema) }),
    z.strictObject({ any: z.array(triggerConditionSchema) }),
    z.strictObject({ not: triggerConditionSchema }),
    z.strictObject({ flagSet: nonEmpty }),
    z.strictObject({ monthAtLeast: z.number().int().min(1).max(12) }),
    z.strictObject({ periodIs: monthPeriodSchema }),
    z.strictObject({ atLocation: idSchema }),
    z.strictObject({
      relationshipAtLeast: z.strictObject({
        char: idSchema,
        field: z.enum(["trust", "affinity"]),
        value: percent,
      }),
    }),
    z.strictObject({ favorAtLeast: z.strictObject({ char: idSchema, value: percent }) }),
    z.strictObject({ rankAtLeast: z.strictObject({ char: idSchema, rank: idSchema }) }),
    z.strictObject({ eventFired: idSchema }),
  ]),
);

// ── effects (the single funnel — plan §6, fully discriminated) ────────
export const eventEffectSchema = z.union([
  z.strictObject({
    type: z.literal("relationship"),
    char: idSchema,
    field: z.enum(["trust", "affinity"]),
    delta,
  }),
  z.strictObject({ type: z.literal("favor"), char: idSchema, delta }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("court"),
    field: z.enum(["authority", "publicSupport", "factionPressure"]),
    delta,
  }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("harem"),
    field: z.enum(["harmony", "jealousy"]),
    delta,
  }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("bloodline"),
    field: z.literal("legitimacy"),
    delta,
  }),
  z.strictObject({
    type: z.literal("set_bloodline_status"),
    field: z.literal("menstrualStatus"),
    value: z.enum(["normal", "irregular", "absent"]),
  }),
  z.strictObject({
    type: z.literal("flag"),
    key: nonEmpty,
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  z.strictObject({ type: z.literal("memory"), char: idSchema, entry: effectMemoryDraftSchema }),
]);

export type EventEffect = z.infer<typeof eventEffectSchema>;

// ── characters ────────────────────────────────────────────────────────
export const characterSchema = z
  .strictObject({
    id: idSchema,
    kind: z.enum(["consort", "official"]),
    profile: z.strictObject({
      name: nonEmpty,
      age: z.number().int().min(14).max(99),
      role: nonEmpty,
      appearance: nonEmpty,
      personalityTraits: z.array(nonEmpty).min(1).max(6),
      coreFacts: z.array(nonEmpty).min(1),
      goals: z.array(nonEmpty).min(1),
      speechStyle: nonEmpty,
    }),
    defaultLocation: idSchema,
    portraitSet: idSchema,
    expressions: z.array(nonEmpty).min(1),
    voice: z.strictObject({
      register: z.enum(["formal", "casual", "rough", "poetic"]),
      quirks: z.array(nonEmpty),
      tabooTopics: z.array(nonEmpty),
    }),
    initialRelationship: relationshipStateSchema,
    initialStanding: characterStandingSchema,
    initialMemories: z.array(initialMemoryDraftSchema),
    secrets: z.array(z.never()).max(0), // schema present, empty in the skeleton (plan §4)
    stances: z.array(z.strictObject({ charId: idSchema, attitude: nonEmpty })).optional(),
  })
  .refine((c) => c.expressions.includes("neutral"), {
    message: 'expressions must include "neutral"',
    path: ["expressions"],
  });

export type CharacterContent = z.infer<typeof characterSchema>;

// ── ranks (位分 table row — world.json) ───────────────────────────────
export const selfRefsSchema = z.strictObject({
  toPlayer: z.array(nonEmpty).min(1),
  formal: z.array(nonEmpty).min(1),
  informal: z.array(nonEmpty).optional(),
});

export const characterRankSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  grade: nonEmpty,
  selfRefs: selfRefsSchema,
  order: z.number().int().min(0),
  domain: z.enum(["harem", "official"]),
  favorTerm: nonEmpty, // 恩宠 (consort) / 圣眷 (official) — display label
});

export type CharacterRank = z.infer<typeof characterRankSchema>;

// ── locations ─────────────────────────────────────────────────────────
export const locationSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  description: nonEmpty,
  backgroundKey: nonEmpty,
  ambience: z.array(nonEmpty),
  position: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  connections: z.array(idSchema).min(1),
  travelCost: z.strictObject({ ap: z.number().int().min(1) }),
});

export type LocationContent = z.infer<typeof locationSchema>;

// ── events ────────────────────────────────────────────────────────────
export const gameEventSchema = z
  .strictObject({
    id: idSchema,
    title: nonEmpty,
    sceneId: idSchema,
    checkpoint: z.enum(["game_start", "location_enter", "time_advance", "scene_end"]),
    condition: triggerConditionSchema,
    priority: z.number().int(),
    once: z.boolean(),
    cooldown: z.strictObject({ actionDays: z.number().int().min(1) }).optional(),
    apCost: z.number().int().min(0), // reserved at entry, spent at commit (plan §6)
    public: z.boolean().optional(),
    headline: z.string().min(1).max(60).optional(),
  })
  .refine((e) => !e.public || e.headline !== undefined, {
    message: "public events require a headline",
    path: ["headline"],
  });

export type GameEventContent = z.infer<typeof gameEventSchema>;

// ── scenes ────────────────────────────────────────────────────────────
export const dialogueChoiceSchema = z.strictObject({
  id: idSchema,
  text: z.string().min(1).max(120),
  tone: z.enum(["friendly", "neutral", "guarded", "hostile", "flirty"]).optional(),
  next: idSchema, // scripted scenes: every choice must route somewhere
  condition: triggerConditionSchema.optional(),
  isExit: z.boolean().optional(),
});

export const sceneNodeSchema = z.union([
  z.strictObject({
    type: z.literal("line"),
    id: idSchema,
    speaker: idSchema,
    text: z.string().min(1).max(600),
    expression: nonEmpty.optional(),
    next: idSchema.optional(), // no next = terminal
  }),
  z.strictObject({
    type: z.literal("choice"),
    id: idSchema,
    choices: z.array(dialogueChoiceSchema).min(1).max(4),
  }),
  z.strictObject({
    type: z.literal("branch"),
    id: idSchema,
    condition: triggerConditionSchema,
    ifTrue: idSchema,
    ifFalse: idSchema,
  }),
  z.strictObject({
    type: z.literal("effect"),
    id: idSchema,
    effects: z.array(eventEffectSchema).min(1),
    next: idSchema.optional(), // no next = terminal
  }),
]);

export type SceneNode = z.infer<typeof sceneNodeSchema>;
export type DialogueChoice = z.infer<typeof dialogueChoiceSchema>;

export const sceneSchema = z
  .strictObject({
    id: idSchema,
    locationId: idSchema,
    participants: z.array(idSchema).min(1),
    startNodeId: idSchema,
    nodes: z.array(sceneNodeSchema).min(1),
  })
  .refine((s) => new Set(s.nodes.map((n) => n.id)).size === s.nodes.length, {
    message: "node ids must be unique within a scene",
    path: ["nodes"],
  });

export type SceneContent = z.infer<typeof sceneSchema>;

// ── lexicon (content/lexicon.json — plan §3.9 of DESIGN) ──────────────
export const worldLexiconSchema = z.strictObject({
  approvedTerms: z.array(nonEmpty).min(1),
  forbiddenTerms: z.array(nonEmpty),
  rankAddressRules: z.array(
    z.strictObject({ rank: idSchema, selfRefs: selfRefsSchema, addressedAs: nonEmpty }),
  ),
  kinshipTerms: z.array(z.strictObject({ concept: nonEmpty, term: nonEmpty })),
  styleRules: z.array(nonEmpty),
});

export type WorldLexicon = z.infer<typeof worldLexiconSchema>;

// ── world.json ────────────────────────────────────────────────────────
export const worldSchema = z.strictObject({
  contentVersion: nonEmpty,
  calendar: z.strictObject({
    apMax: z.number().int().min(1),
    start: z.strictObject({
      year: z.number().int().min(1),
      month: z.number().int().min(1).max(12),
      period: monthPeriodSchema,
    }),
  }),
  startingLocation: idSchema,
  startingResources: z.strictObject({
    court: z.strictObject({
      authority: percent,
      publicSupport: percent,
      factionPressure: percent,
    }),
    harem: z.strictObject({ harmony: percent, jealousy: percent }),
    bloodline: z.strictObject({
      legitimacy: percent,
      menstrualStatus: z.enum(["normal", "irregular", "absent"]),
    }),
  }),
  ranks: z.array(characterRankSchema).min(1),
});

export type WorldContent = z.infer<typeof worldSchema>;
