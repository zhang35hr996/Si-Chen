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
import type { CharacterStanding } from "../state/types";
import { dialogueClaimSchema } from "../dialogue/claims";

// ── shared primitives ─────────────────────────────────────────────────
export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "ids are lowercase snake_case ascii");

/**
 * Canonical engine vocabulary (stable enum IDs, NOT display words). The narrative
 * `personalityTraits` / `attitude` strings stay free-text for authoring and the LLM;
 * these machine fields are what the ReactionPlanner derives from, so the engine
 * contract never drifts with copy wording.
 */
export const canonicalReactionTraitSchema = z.enum([
  "status_conscious", "compassionate", "cold", "discreet", "blunt", "impulsive", "calculating", "proud",
]);
export type CanonicalReactionTrait = z.infer<typeof canonicalReactionTraitSchema>;

export const relationStanceSchema = z.enum([
  "devoted", "friendly", "neutral", "competitive", "contemptuous", "hostile",
]);
export type RelationStance = z.infer<typeof relationStanceSchema>;

const percent = z.number().int().min(0).max(100);
/** Content-declared deltas are bounded ±10 per effect (plan §6). */
const delta = z.number().int().min(-10).max(10);
const nonEmpty = z.string().min(1);

const tagSchema = z.string().regex(/^[a-z0-9_]+$/, "tags are lowercase ascii");
const participantSchema = z.union([z.literal("player"), idSchema]);

export const monthPeriodSchema = z.enum(["early", "mid", "late"]);

// ── per-character runtime fragments (bound to engine/state/types) ─────

/** GameTime 形状（与 save/stateSchema 的 gameTimeSchema 对齐；本地定义避免跨模块循环依赖）。 */
export const gameTimeShape = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().min(0),
});

export const deathRecordSchema = z.strictObject({
  diedAt: gameTimeShape,
  cause: z.enum(["illness", "critical_sudden", "pregnancy", "childbirth", "scripted", "imperial_execution"]),
  originalRankId: idSchema,
  originalTitle: nonEmpty.optional(),
  posthumousRankId: idSchema.optional(),
  posthumousEpithet: z.string().min(1).max(2).optional(),
});

export const characterStandingSchema = z.strictObject({
  rank: idSchema,
  favor: percent,
  title: nonEmpty.optional(),
  lifecycle: z.enum(["normal", "candidate", "carrying", "delivered", "deceased"]).optional(),
  recoverUntilMonth: z.number().int().min(1).optional(),
  residence: idSchema.optional(),
  chamber: z.enum(["main", "east_side", "west_side", "east_annex", "west_annex"]).optional(),
  affection: percent.optional(),
  palaceEnteredAt: gameTimeShape.optional(),
  availableFromMonth: z.number().int().min(1).optional(),
  health: percent.optional(),
  healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
  lastPhysicianVisitMonthKey: z.string().optional(),
  ageAtEntry: z.number().int().min(0).optional(),
  enteredAtYear: z.number().int().min(1).optional(),
  deathRecord: deathRecordSchema.optional(),
}) satisfies z.ZodType<CharacterStanding>;

// ── memory drafts ─────────────────────────────────────────────────────
export const memoryKindSchema = z.enum([
  "episodic", "trauma", "grievance", "gratitude", "promise", "secret", "impression",
]);
export const memoryEmotionSchema = z.enum(["joy","grief","fear","anger","envy","shame","guilt","relief"]);
const memoryPerspectiveSchema = z.enum(["actor","target","witness","parent","ally","enemy","relative"]);

/** 单个情绪强度 0–100。 */
const emotionValueSchema = z.number().min(0).max(100);
/**
 * Partial record of emotion intensities — keys derived from memoryEmotionSchema
 * (no hand-listing → cannot drift from the enum), values bounded to 0–100, and
 * unknown emotion keys rejected. Mirrored in save/stateSchema; kept equivalent
 * by tests/state/memoryEmotionsParity.test.ts.
 */
export const memoryEmotionsSchema = z.partialRecord(memoryEmotionSchema, emotionValueSchema);

const memoryDraftBase = z.strictObject({
  kind: memoryKindSchema,
  summary: z.string().min(1).max(240),
  subjectIds: z.array(participantSchema).min(1),
  perspective: memoryPerspectiveSchema,
  strength: percent,
  triggerTags: z.array(tagSchema).max(5),
  unresolved: z.boolean().default(false),
  emotions: memoryEmotionsSchema.default({}),
  sourceEventId: z.string().regex(/^evt_\d{6}$/).optional(), // 格式 evt_NNNNNN（content 层不能 import 上层 courtEventIdSchema，内联同正则）
});

export const initialMemoryDraftSchema = memoryDraftBase.extend({
  retention: z.enum(["fast", "slow", "permanent"]).default("slow"),
});
export const effectMemoryDraftSchema = memoryDraftBase.extend({
  retention: z.enum(["fast", "slow", "permanent"]),
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
    z.strictObject({ favorAtLeast: z.strictObject({ char: idSchema, value: percent }) }),
    z.strictObject({ rankAtLeast: z.strictObject({ char: idSchema, rank: idSchema }) }),
    z.strictObject({ hasMemoryTag: z.strictObject({ char: idSchema, tag: tagSchema }) }),
    z.strictObject({ eventFired: idSchema }),
  ]),
);

// ── effects (the single funnel — plan §6, fully discriminated) ────────

/** 位分操作发起者：皇帝直接敕封 vs 六宫代理侍君行政处分。 */
export const rankOperationAuthoritySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sovereign"), actorId: z.literal("player") }),
  z.object({ kind: z.literal("harem_administrator"), actorId: z.string() }),
]);
export type RankOperationAuthority = z.infer<typeof rankOperationAuthoritySchema>;

const deathCauseSchema = z.enum(["illness", "critical_sudden", "pregnancy", "childbirth", "scripted", "imperial_execution"]);

export const eventEffectSchema = z.union([
  z.strictObject({ type: z.literal("favor"), char: idSchema, delta }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("sovereign"),
    field: z.enum([
      "health",
      "diligence",
      "prestige",
      "martial",
      "statecraft",
      "cruelty",
      "fatigue",
      "regimeSecurity",
    ]),
    delta,
  }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("nation"),
    field: z.enum([
      "military",
      "publicSupport",
      "productivity",
      "governance",
      "consortClanPower",
      "ministerLoyalty",
      "corruption",
      "clanDiscontent",
      "rumor",
    ]),
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
  z.strictObject({ type: z.literal("set_rank"), char: idSchema, rank: idSchema, authority: rankOperationAuthoritySchema.optional() }),
  z.strictObject({ type: z.literal("set_title"), char: idSchema, title: z.string().min(1).max(4), authority: rankOperationAuthoritySchema.optional() }),
  z.strictObject({ type: z.literal("remove_title"), char: idSchema, authority: rankOperationAuthoritySchema.optional() }),
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
  z.strictObject({ type: z.literal("consort_miscarriage"), carrierId: idSchema }),
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
  z.strictObject({ type: z.literal("heir_died"), heirId: nonEmpty }),
  z.strictObject({
    type: z.literal("relocate"),
    char: idSchema,
    location: idSchema,
    chamber: z.enum(["main", "east_side", "west_side", "east_annex", "west_annex"]),
  }),
  z.strictObject({
    type: z.literal("set_consort_health"),
    char: idSchema,
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_sovereign_health"),
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_taihou_health"),
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_heir_health"),
    heirId: nonEmpty,
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_consort_posthumous"),
    char: idSchema,
    posthumousRankId: idSchema.optional(),
    posthumousEpithet: z.string().min(1).max(2).optional(),
  }),
  z.strictObject({
    type: z.literal("confine"),
    char: idSchema,
    startTurn: z.number().int().min(0),
    endTurnExclusive: z.union([z.number().int().min(0), z.null()]),
    imposedAt: gameTimeShape,
    sourceLocation: idSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("lift_confinement"),
    char: idSchema,
    at: gameTimeShape,
    reason: z.enum(["lifted_by_emperor", "term_expired"]),
  }),
  z.strictObject({ type: z.literal("consort_decease"), char: idSchema, at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({ type: z.literal("heir_decease"), heirId: nonEmpty, at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({ type: z.literal("taihou_decease"), at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({
    type: z.literal("enqueue_aftermath"),
    id: nonEmpty,
    kind: z.enum(["taihou", "consort", "heir"]),
    subjectId: idSchema,
    at: gameTimeShape,
  }),
  z.strictObject({
    type: z.literal("set_harem_administration"),
    state: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("empress") }),
      z.strictObject({
        mode: z.literal("acting_consort"),
        charId: idSchema,
        appointedAt: gameTimeShape,
        reason: z.literal("empress_confined"),
      }),
      z.strictObject({
        mode: z.literal("neiwu_proxy"),
        appointedAt: gameTimeShape,
        reason: z.literal("no_eligible_consort"),
      }),
    ]),
  }),
  z.strictObject({
    type: z.literal("record_physician_visit"),
    subject: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("sovereign") }),
      z.strictObject({ kind: z.literal("taihou") }),
      z.strictObject({ kind: z.literal("consort"), id: idSchema }),
      z.strictObject({ kind: z.literal("heir"), id: idSchema }),
    ]),
    monthKey: z.string().min(1),
  }),
]);

export type EventEffect = z.infer<typeof eventEffectSchema>;

// ── consort attributes (侍君明面属性 — docs/systems/21-attribute-catalog.md) ──
// Static, card-facing养成 attributes. 年龄 lives in profile.age, 性格 in
// profile.personalityTraits, 位分/恩宠 in standing, 住处 in standing.chamber.
// 特长(specialty) 是标签而非数值；喜好(likes) 是标签数组。
export const consortAttributesSchema = z.strictObject({
  appearance: percent, // 容貌
  health: percent, // 健康
  nurture: percent, // 承养资质
  specialty: nonEmpty, // 特长（标签，如 古筝/舞蹈）
  likes: z.array(nonEmpty), // 喜好（标签，如 玉器/马具）
});

export type ConsortAttributes = z.infer<typeof consortAttributesSchema>;

// ── consort hidden attributes (侍君暗属性) ────────────────────────────
// 开发期全显示；正式版 ??? 由血滴子解锁。情意作为 authored 初值；后期接入运行时。
export const consortHiddenSchema = z.strictObject({
  affection: percent, // 情意
  fear: percent, // 恐惧
  ambition: percent, // 野心
});

export type ConsortHidden = z.infer<typeof consortHiddenSchema>;

// 自称（位分 selfRefs 复用；尊长无位分时由 character.selfRefs 直接提供）。
export const selfRefsSchema = z.strictObject({
  toPlayer: z.array(nonEmpty).min(1),
  formal: z.array(nonEmpty).min(1),
  informal: z.array(nonEmpty).optional(),
});

// ── characters ────────────────────────────────────────────────────────
export const characterSchema = z
  .strictObject({
    id: idSchema,
    kind: z.enum(["consort", "official", "elder"]),
    /** 侍君明面属性. Optional: officials carry no养成 stat block. */
    attributes: consortAttributesSchema.optional(),
    /** 侍君暗属性. Optional: officials carry none. */
    hidden: consortHiddenSchema.optional(),
    profile: z.strictObject({
      name: nonEmpty,
      surname: nonEmpty.optional(),
      age: z.number().int().min(14).max(99),
      role: nonEmpty,
      appearance: nonEmpty,
      personalityTraits: z.array(nonEmpty).min(1).max(6),
      /** Canonical engine traits the ReactionPlanner derives disposition from
       *  (narrative personalityTraits are NOT parsed). [] for non-reaction roles. */
      reactionTraits: z.array(canonicalReactionTraitSchema).max(6).default([]),
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
    initialStanding: characterStandingSchema.optional(),
    /** 尊长（elder）无位分，自称由此提供（如太后『哀家』）。位分角色用 rank.selfRefs。 */
    selfRefs: selfRefsSchema.optional(),
    initialMemories: z.array(initialMemoryDraftSchema),
    secrets: z.array(z.never()).max(0), // schema present, empty in the skeleton (plan §4)
    stances: z.array(z.strictObject({
      charId: idSchema,
      /** Engine-used relation category. The narrative `attitude` is for authors/LLM only. */
      stance: relationStanceSchema,
      attitude: nonEmpty,
    })).optional(),
    dialoguePolicy: z.strictObject({
      forbiddenClaims: z.array(dialogueClaimSchema).max(16),
    }).optional(),
    maternalClan: z
      .strictObject({
        postId: idSchema,
        legitimate: z.boolean(),
        birthOrder: z.number().int().min(1),
      })
      .optional(),
  })
  .refine((c) => c.expressions.includes("neutral"), {
    message: 'expressions must include "neutral"',
    path: ["expressions"],
  });

export type CharacterContent = z.infer<typeof characterSchema>;

// ── items (content/items.json — 库房物品目录) ─────────────────────────
export const itemTierSchema = z.enum(["common", "fine", "treasure", "marvel"]);
export const itemCategorySchema = z.enum([
  "妆品", "香", "绸缎", "皮毛", "文房", "乐器",
  "玩器", "点心", "茶饮", "珍味", "器玩", "珍禽异兽",
]);
export const itemDefSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  category: itemCategorySchema,
  tier: itemTierSchema,
  tags: z.array(z.string()).max(8),
});
export type ItemDef = z.infer<typeof itemDefSchema>;
export const itemsFileSchema = z.strictObject({ items: z.array(itemDefSchema) });

// ── official posts (官职表 — world.json) ─────────────────────────────
export const officialPostSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  grade: nonEmpty,
  gradeOrder: z.number().int().min(0).max(18),
});
export type OfficialPost = z.infer<typeof officialPostSchema>;

// ── ranks (位分 table row — world.json) ───────────────────────────────
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
    backgroundPosition: nonEmpty.optional(), // 背景裁切焦点（如 "62% center"）；缺省 center（SceneShell 用）
    ambience: z.array(nonEmpty),
    position: normalizedPosition,
    zone: idSchema.default("palace"),
    entry: z.enum(["travel", "free"]).default("travel"),
    connections: z.array(idSchema).min(1).optional(),
    travelCost: z.strictObject({ ap: z.number().int().min(0) }).optional(), // 0 = 宫内移动免行动力
    actionEventId: idSchema.optional(),
    actionFirstSlotOnly: z.boolean().optional(),
    // 子地点（御花园探索）。每子地点带自己的静态环境描述与背景；人物/事件线索只在事件
    // 存在时由 event.presentation.eventHint 提供（不在此静态暗示）。详见设计规格 §8.1。
    subLocations: z
      .array(
        z.strictObject({
          id: idSchema,
          name: nonEmpty,
          backgroundKey: nonEmpty,
          backgroundPosition: nonEmpty.optional(), // 每子地点独立裁切焦点
          description: nonEmpty, // 静态环境（永久成立，无人物/事件暗示）
        }),
      )
      .optional(),
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
    // "court" 是上朝专用挂载点：不参与任何自动 checkpoint（game_start/
    // location_enter/time_advance/scene_end），仅由上朝会话随机抽取播放。
    checkpoint: z.enum(["game_start", "location_enter", "time_advance", "scene_end", "court"]),
    condition: triggerConditionSchema,
    priority: z.number().int(),
    once: z.boolean(),
    cooldown: z.strictObject({ actionDays: z.number().int().min(1) }).optional(),
    apCost: z.number().int().min(0), // reserved at entry, spent at commit (plan §6)
    // 呈现契约（可选）：声明事件「如何呈现」。checkpoint 仍负责 eligibility；
    // presentation.mode 负责呈现分流（候见/探索/手动/上朝/进门直开）。缺省由
    // resolveEntryMode 按 checkpoint+地点推导。详见 scene-ui-narrative-refactor 设计规格 §3.1。
    presentation: z
      .discriminatedUnion("mode", [
        z.strictObject({
          mode: z.literal("request_audience"),
          hostLocationId: idSchema, // 候见归属地点（呈现宿主，独立于 condition.atLocation）
          audienceCharacterId: idSchema, // 候见者（立绘/名牌来源）
          audiencePrompt: nonEmpty, // 候见提示文案（叙事口吻，UI 不硬编码）
        }),
        z.strictObject({
          mode: z.literal("exploration"),
          hostLocationId: idSchema, // 御花园等宿主地点
          subLocationId: idSchema, // 静态绑定的子地点
          eventHint: nonEmpty.optional(), // 仅事件存在时显示的线索
        }),
        z.strictObject({ mode: z.literal("auto_on_enter") }),
        z.strictObject({ mode: z.literal("manual") }),
        z.strictObject({ mode: z.literal("scheduled") }),
      ])
      .optional(),
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
  sovereign: z.strictObject({
    startingAge: z.number().int().min(0),
  }),
  startingResources: z.strictObject({
    sovereign: z.strictObject({
      health: percent,
      diligence: percent,
      prestige: percent,
      martial: percent,
      statecraft: percent,
      cruelty: percent,
      fatigue: percent,
      regimeSecurity: percent,
    }),
    nation: z.strictObject({
      military: percent,
      treasury: z.number().int().min(0),
      publicSupport: percent,
      productivity: percent,
      governance: percent,
      consortClanPower: percent,
      ministerLoyalty: percent,
      corruption: percent,
      clanDiscontent: percent,
      rumor: percent,
    }),
    bloodline: z.strictObject({
      menstrualStatus: z.enum(["normal", "irregular", "absent"]),
    }),
  }),
  ranks: z.array(characterRankSchema).min(1),
  officialPosts: z.array(officialPostSchema).min(1),
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
