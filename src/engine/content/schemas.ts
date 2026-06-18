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
  title: nonEmpty.optional(),
  lifecycle: z.enum(["normal", "candidate", "carrying", "delivered", "deceased"]).optional(),
  recoverUntilMonth: z.number().int().min(1).optional(),
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
  | { hasMemoryTag: { char: string; tag: string } }
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
    z.strictObject({ hasMemoryTag: z.strictObject({ char: idSchema, tag: tagSchema }) }),
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
  z.strictObject({ type: z.literal("set_rank"), char: idSchema, rank: idSchema }),
  z.strictObject({ type: z.literal("set_title"), char: idSchema, title: z.string().min(1).max(4) }),
  z.strictObject({ type: z.literal("remove_title"), char: idSchema }),
  z.strictObject({
    type: z.literal("bedchamber"),
    char: idSchema,
    mode: z.enum(["passion", "pleasure", "companionship"]),
  }),
  z.strictObject({
    type: z.literal("pregnancy"),
    op: z.enum(["begin", "carry", "clear"]),
  }),
  z.strictObject({ type: z.literal("heir_designate"), charIds: z.array(idSchema).min(1).max(8) }),
  z.strictObject({ type: z.literal("heir_candidate"), op: z.enum(["add", "remove"]), char: idSchema }),
  z.strictObject({
    type: z.literal("pregnancy_transfer"),
    carrierId: idSchema,
    atMonth: z.number().int().min(1),
  }),
  z.strictObject({ type: z.literal("pregnancy_abort") }),
  z.strictObject({
    type: z.literal("birth"),
    sex: z.enum(["daughter", "son"]),
    fatherId: z.union([idSchema, z.null()]),
    bearer: z.union([z.literal("sovereign"), idSchema]),
    legitimate: z.boolean(),
    favor: percent,
    bearerOutcome: z.enum(["safe", "child_dies", "bearer_dies", "both"]),
    recoverUntilMonth: z.number().int().min(1).optional(),
  }),
  z.strictObject({ type: z.literal("memory"), char: idSchema, entry: effectMemoryDraftSchema }),
  z.strictObject({
    type: z.literal("heir_name"),
    heirId: nonEmpty,
    field: z.enum(["pet", "given"]),
    name: z.string().min(1).max(2),
  }),
  z.strictObject({ type: z.literal("heir_summon"), heirId: nonEmpty }),
  z.strictObject({
    type: z.literal("heir_educate"),
    heirId: nonEmpty,
    subject: z.enum(["scholarship", "martial", "virtue"]),
    attrDelta: z.number().int().min(0).max(20),
    favorDelta: z.number().int().min(0).max(20),
  }),
  z.strictObject({ type: z.literal("heir_adopt"), heirId: nonEmpty, fatherId: idSchema }),
  z.strictObject({ type: z.literal("child_favor"), heirId: nonEmpty, delta }),
]);

export type EventEffect = z.infer<typeof eventEffectSchema>;

// ── consort attributes (侍君明面属性 — background §四.4.1) ──────────────
// Static, card-facing养成 attributes. 年龄 lives in profile.age and 性格 in
// profile.personalityTraits; these five are the numeric stats the card shows.
export const consortAttributesSchema = z.strictObject({
  appearance: percent, // 容貌
  talent: percent, // 才情
  family: percent, // 家世
  health: percent, // 健康
  nurture: percent, // 承养资质
});

export type ConsortAttributes = z.infer<typeof consortAttributesSchema>;

// ── characters ────────────────────────────────────────────────────────
export const characterSchema = z
  .strictObject({
    id: idSchema,
    kind: z.enum(["consort", "official"]),
    /** 侍君明面属性. Optional: officials carry no养成 stat block. */
    attributes: consortAttributesSchema.optional(),
    profile: z.strictObject({
      name: nonEmpty,
      surname: nonEmpty.optional(),
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

// ── map boards & portals (world.json — data-driven 主图/子图 graph) ─────
// A board is one navigable map screen (宫城图 / 后宫 / 京城 / 郊外). Portals are
// the免行动点 buttons that switch from one board to another (出宫, 后宫, 郊外…).
// A location's `zone` says which board hosts its node. Boards are optional in
// world.json: when omitted, zone validation is skipped (minimal/test content).
const normalizedPosition = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const mapBoardSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  /** Board backdrop art. kind "map" supports time-of-day variants (宫城图);
   *  kind "background" is a single full-scene image (京城/郊外/后宫). */
  art: z.strictObject({
    key: nonEmpty,
    kind: z.enum(["map", "background"]).default("background"),
  }),
});

export type MapBoard = z.infer<typeof mapBoardSchema>;

export const mapPortalSchema = z.strictObject({
  /** Board this portal button appears on. */
  from: idSchema,
  /** Board it switches to. */
  to: idSchema,
  /** Button label, e.g. 出宫 / 后宫 / 郊外. */
  name: nonEmpty,
  position: normalizedPosition,
});

export type MapPortal = z.infer<typeof mapPortalSchema>;

// ── locations ─────────────────────────────────────────────────────────
// zone   — which map board a node lives on (must be a world.json mapBoards id
//          when boards are declared; defaults to "palace" 主图).
// entry  — "travel" places cost AP and become playerLocation (full screen);
//          "free" places open a read-only view (冷宫/朝会), no AP, no relocation.
// actionEventId — a free-view may offer one AP-costing action (e.g. 上朝).
export const locationSchema = z
  .strictObject({
    id: idSchema,
    name: nonEmpty,
    description: nonEmpty,
    backgroundKey: nonEmpty,
    ambience: z.array(nonEmpty),
    position: normalizedPosition,
    zone: idSchema.default("palace"),
    entry: z.enum(["travel", "free"]).default("travel"),
    connections: z.array(idSchema).min(1).optional(),
    travelCost: z.strictObject({ ap: z.number().int().min(1) }).optional(),
    actionEventId: idSchema.optional(),
    actionFirstSlotOnly: z.boolean().optional(),
  })
  .refine((loc) => loc.entry === "free" || (loc.connections !== undefined && loc.travelCost !== undefined), {
    message: 'travel locations require "connections" and "travelCost"',
    path: ["travelCost"],
  })
  .refine((loc) => loc.entry === "free" || loc.actionEventId === undefined, {
    message: '"actionEventId" is only for free-view locations',
    path: ["actionEventId"],
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

// ── rank change reactions (位分/封号 op templates — rank/title system) ──
const rankReactionSchema = z.strictObject({
  lines: z.array(nonEmpty).min(1).max(3),
  memory: nonEmpty,
});

export const rankChangeReactionsSchema = z.strictObject({
  promote: rankReactionSchema,
  demote: rankReactionSchema,
  grant_title: rankReactionSchema,
  strip_title: rankReactionSchema,
});

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
  /** Map boards (主图/子图). Optional: minimal content omits the map graph. */
  mapBoards: z.array(mapBoardSchema).min(1).optional(),
  /** Portal buttons linking boards (出宫/后宫/郊外). */
  mapPortals: z.array(mapPortalSchema).optional(),
  /** Templated consort reactions to 位分/封号 ops (rank/title system). */
  rankChangeReactions: rankChangeReactionsSchema.optional(),
  /** 侍寝/受孕调参（缺省走引擎内置 fallback）。 */
  bedchamber: z
    .strictObject({
      conceptionChance: percent,
      tiers: z.strictObject({
        small: z.number().int().min(1),
        favored: z.number().int().min(1),
        abundant: z.number().int().min(1),
      }),
    })
    .optional(),
  /** 模板化侍寝体验台词（按 mode）。 */
  bedchamberScript: z
    .strictObject({
      passion: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
      pleasure: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
      // 陪伴按双方孕情分四种台词：lines=二人都无孕（缺省）；其余三种可选，
      // 缺省回退到 lines / 引擎内置 fallback。
      companionship: z.strictObject({
        lines: z.array(nonEmpty).min(1).max(6),
        sovereignPregnant: z.array(nonEmpty).min(1).max(6).optional(),
        consortPregnant: z.array(nonEmpty).min(1).max(6).optional(),
        bothPregnant: z.array(nonEmpty).min(1).max(6).optional(),
      }),
    })
    .optional(),
  /** 承嗣/生产/子嗣调参（缺省走引擎内置 fallback）。 */
  gestation: z
    .strictObject({
      termMonths: z.number().int().min(1),
      transferEarliestMonth: z.number().int().min(1),
      earlyBirth: z.strictObject({ month8: percent, month9: percent }),
      recovery: z.strictObject({ safeMonths: z.number().int().min(0), dystociaMonths: z.number().int().min(0) }),
      dystocia: z.strictObject({
        baseAtMonth3: percent,
        perMonthAfter: z.number().int().min(0),
        outcomeSplit: z.strictObject({ childDies: percent, bearerDies: percent, both: percent }),
      }),
      childFavor: z.strictObject({
        selfPregnancy: percent,
        fenghouBonus: percent,
        tierValues: z.strictObject({
          abundant: percent,
          favored: percent,
          small: percent,
          fallen: percent,
          none: percent,
        }),
      }),
    })
    .optional(),
});

export type WorldContent = z.infer<typeof worldSchema>;
