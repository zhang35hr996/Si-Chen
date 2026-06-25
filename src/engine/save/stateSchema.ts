/**
 * Runtime validation for LOADED GameState (skeleton-plan §9). A save that
 * fails this schema is corrupt — quarantined, never silently loaded.
 */
import { z } from "zod";
import { calendarInvariantViolation, type CalendarState } from "../calendar/time";
import {
  characterStandingSchema,
  characterSchema,
  idSchema,
  memoryKindSchema,
} from "../content/schemas";

import type { GameState } from "../state/types";
import { validateJusticeState } from "../justice/validation";
import { validateJusticeLinks } from "../justice/crossLink";

const nonEmpty = z.string().min(1);

const percent = z.number().int().min(0).max(100);

export const courtEventIdSchema = z.string().regex(/^evt_\d{6}$/);

export const gameTimeSchema = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().min(0),
});

const calendarStateSchema = gameTimeSchema
  .extend({
    ap: z.number().int().min(0),
    apMax: z.number().int().min(1),
    eraName: z.string().default(""),
  })
  .refine((cal) => calendarInvariantViolation(cal as CalendarState) === null, {
    message: "impossible calendar state",
  });

/** 情绪键枚举（与 content/schemas 的 memoryEmotionSchema 对齐；跨层不共享 import，靠 parity 测试防漂移）。 */
const memoryEmotionSchema = z.enum(["joy","grief","fear","anger","envy","shame","guilt","relief"]);
/** 单个情绪强度 0–100。 */
const emotionValueSchema = z.number().min(0).max(100);
/**
 * Partial record of emotion intensities — keys derived from the enum (no
 * hand-listing), values bounded 0–100, unknown keys rejected. Mirror of
 * content/schemas memoryEmotionsSchema; kept equivalent by
 * tests/state/memoryEmotionsParity.test.ts.
 */
export const memoryEmotionsSchema = z.partialRecord(memoryEmotionSchema, emotionValueSchema);

const memoryEntrySchema = z.strictObject({
  id: z.string().min(1),
  ownerId: idSchema,
  kind: memoryKindSchema,
  sourceEventId: courtEventIdSchema.optional(),
  sourcePunishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
  sourceCaseId: z.string().regex(/^case_\d{6}$/).optional(),

  subjectIds: z.array(z.string()).min(1),
  perspective: z.enum(["actor","target","witness","parent","ally","enemy","relative"]),
  summary: z.string().min(1).max(240),
  strength: percent,
  retention: z.enum(["fast", "slow", "permanent"]),
  emotions: memoryEmotionsSchema,
  triggerTags: z.array(z.string()).max(5),
  unresolved: z.boolean(),
  createdAt: gameTimeSchema,
});

const officialStatusReasonSchema = z.enum([
  "retirement", "dismissal", "imprisonment", "exile", "natural_death", "execution",
]);

const officialAptitudeSchema = z.strictObject({
  governance: percent,
  scholarship: percent,
  military: percent,
  integrity: percent,
});

const officialReviewStateSchema = z.strictObject({
  merit: percent,
  lastReviewedYear: z.number().int().min(1).optional(),
  underperformanceYears: z.number().int().min(0),
});

const officialSchema = z.strictObject({
  id: idSchema,
  surname: z.string().min(1),
  givenName: z.string().min(1),
  postId: idSchema.nullable(),
  loyalty: percent,
  age: z.number().int().min(1),
  familyId: idSchema,
  status: z.enum(["active", "retired", "imprisoned", "exiled", "dead"]),
  aptitude: officialAptitudeSchema,
  reviewState: officialReviewStateSchema,
  appointedAt: gameTimeSchema.optional(),
  statusChangedAt: gameTimeSchema.optional(),
  statusReason: officialStatusReasonSchema.optional(),
  deathAt: gameTimeSchema.optional(),
});

const officialFamilySchema = z.strictObject({
  id: idSchema,
  surname: z.string().min(1),
  influence: percent,
  imperialFavor: percent,
});

const familyMemberSchema = z.strictObject({
  id: idSchema,
  familyId: idSchema,
  name: z.string().min(1),
  surname: z.string().min(1),
  sex: z.enum(["female", "male"]),
  age: z.number().int().min(1),
  role: z.enum(["matriarch", "consort_in", "daughter", "son", "sister"]),
  deceasedAt: gameTimeSchema.optional(),
});

const kinshipSchema = z.strictObject({
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  type: z.enum(["mother", "daughter", "son", "sibling", "spouse", "close_relative"]),
});

const pendingRetirementSchema = z.strictObject({
  officialId: idSchema,
  requestedAt: gameTimeSchema,
});

const officialHistorySchema = z.strictObject({
  id: z.string().min(1),
  officialId: idSchema,
  status: z.enum(["active", "retired", "imprisoned", "exiled", "dead"]),
  reason: officialStatusReasonSchema.optional(),
  at: gameTimeSchema,
  vacatedPostId: idSchema.optional(),
  appointment: z
    .strictObject({
      candidateId: idSchema,
      examinationYear: z.number().int().min(1),
      examinationRank: z.number().int().min(1),
      postId: idSchema,
      ageAtAppointment: z.number().int().min(1),
    })
    .optional(),
  punishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
});

const candidateAptitudeSchema = z.strictObject({
  governance: percent,
  scholarship: percent,
  military: percent,
  integrity: percent,
});

const officialCandidateSchema = z.strictObject({
  id: idSchema,
  surname: z.string().min(1),
  givenName: z.string().min(1),
  age: z.number().int().min(1),
  familyId: idSchema.nullable(),
  origin: z.enum(["examination", "recommendation"]),
  examinationYear: z.number().int().min(1),
  examinationRank: z.number().int().min(1),
  aptitude: candidateAptitudeSchema,
  status: z.enum(["eligible", "appointed", "expired", "withdrawn"]),
  enteredPoolAt: gameTimeSchema,
  expiresAtYear: z.number().int().min(1),
  appointedOfficialId: idSchema.optional(),
});

const examinationResultSchema = z.strictObject({
  year: z.number().int().min(1),
  generatedAt: gameTimeSchema,
  candidateIds: z.array(idSchema),
  acknowledged: z.boolean(),
});

const personnelChangeSchema = z.strictObject({
  officialId: idSchema,
  kind: z.enum(["promotion", "demotion", "fill", "appointment"]),
  fromPostId: idSchema.nullable(),
  toPostId: idSchema.nullable(),
  candidateId: idSchema.optional(),
  authority: z.literal("system_review"),
});

const annualReviewRecordSchema = z.strictObject({
  year: z.number().int().min(1),
  at: gameTimeSchema,
  changes: z.array(personnelChangeSchema),
});

const flagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

/** 角色持续状态（禁足等）。活跃判定见 characters/confinement.ts，不存「剩余月份」。 */
const statusEffectSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("confinement"),
  characterId: idSchema,
  startTurn: z.number().int().min(0),
  endTurnExclusive: z.union([z.number().int().min(0), z.null()]),
  imposedAt: gameTimeSchema,
  imposedBy: z.literal("emperor"),
  sourceLocation: idSchema.optional(),
  liftedAt: gameTimeSchema.optional(),
  liftedTurn: z.number().int().min(0).optional(),
  liftReason: z.enum(["lifted_by_emperor", "term_expired"]).optional(),
  sourcePunishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
});

// ── Justice state schemas ─────────────────────────────────────────────────────

const caseIdSchema = z.string().regex(/^case_\d{6}$/);
const punishmentIdSchema = z.string().regex(/^pun_\d{6}$/);
const chargeIdSchema = z.string().regex(/^chg_\d{6}$/);
const evidenceIdSchema = z.string().regex(/^evi_\d{6}$/);
const confessionIdSchema = z.string().regex(/^cnf_\d{6}$/);
const verdictIdSchema = z.string().regex(/^vdt_\d{6}$/);

const chargeRecordSchema = z.strictObject({
  id: chargeIdSchema,
  summary: z.string(),
  allegedAt: gameTimeSchema,
  allegedBy: z.string(),
  status: z.enum(["alleged", "proven", "dismissed"]),
});

const evidenceRecordSchema = z.strictObject({
  id: evidenceIdSchema,
  kind: z.enum(["testimony", "document", "physical", "medical", "observation", "intelligence"]),
  summary: z.string(),
  discoveredAt: gameTimeSchema,
  discoveredBy: z.string(),
  sourceIds: z.array(z.string()),
  reliability: z.number().int().min(0).max(100),
});

const confessionRecordSchema = z.strictObject({
  id: confessionIdSchema,
  byId: z.string(),
  recordedAt: gameTimeSchema,
  summary: z.string(),
  voluntary: z.boolean(),
  retractedAt: gameTimeSchema.optional(),
});

const verdictRecordSchema = z.strictObject({
  id: verdictIdSchema,
  decidedAt: gameTimeSchema,
  decidedBy: z.string(),
  findings: z.array(z.strictObject({
    chargeId: chargeIdSchema,
    result: z.enum(["proven", "not_proven", "dismissed"]),
  })),
  summary: z.string().optional(),
});

const caseRecordSchema = z.strictObject({
  id: caseIdSchema,
  status: z.enum(["open", "decided", "closed"]),
  subjectIds: z.array(z.string()),
  openedAt: gameTimeSchema,
  openedBy: z.string(),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("imperial") }),
    z.strictObject({ kind: z.literal("investigation"), investigationId: z.string().optional() }),
    z.strictObject({ kind: z.literal("scripted"), sourceId: z.string() }),
  ]),
  publicity: z.enum(["secret", "palace", "public"]),
  charges: z.array(chargeRecordSchema),
  evidence: z.array(evidenceRecordSchema),
  confessions: z.array(confessionRecordSchema),
  verdict: verdictRecordSchema.optional(),
  punishmentIds: z.array(punishmentIdSchema),
  closedAt: gameTimeSchema.optional(),
});

const punishmentLifecycleSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("active") }),
  z.strictObject({
    status: z.literal("completed"),
    resolvedAt: gameTimeSchema,
    resolution: z.enum(["immediate", "expired", "target_deceased"]),
  }),
  z.strictObject({
    status: z.literal("lifted"),
    resolvedAt: gameTimeSchema,
    resolution: z.enum(["lifted_by_decree", "authority_restored", "pardoned"]),
  }),
]);

/** 官员惩戒：仅允许即时完成。 */
const immediatePunishmentLifecycleSchema = z.strictObject({
  status: z.literal("completed"),
  resolvedAt: gameTimeSchema,
  resolution: z.literal("immediate"),
});

const punishmentBaseSchema = z.object({
  id: punishmentIdSchema,
  caseId: caseIdSchema.optional(),
  targetId: z.string(),
  targetKind: z.enum(["consort", "official"]),
  actorId: z.string(),
  severity: z.enum(["minor", "moderate", "severe", "terminal"]),
  imposedAt: gameTimeSchema,
  sourceLocation: z.string().optional(),
  publicity: z.enum(["secret", "palace", "public"]),
  lifecycle: punishmentLifecycleSchema,
});

const punishmentRecordSchema = z.discriminatedUnion("kind", [
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("rank_demotion"), details: z.strictObject({ fromRankId: z.string(), toRankId: z.string() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("strip_title"), details: z.strictObject({ removedTitle: z.string() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("finite_confinement"), details: z.strictObject({ statusEffectId: z.string(), endTurnExclusive: z.number().int() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("indefinite_confinement"), details: z.strictObject({ statusEffectId: z.string() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("cold_palace"), details: z.strictObject({ previousResidenceId: z.string(), coldPalaceResidenceId: z.string() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("execution"), details: z.strictObject({ deathCause: z.literal("imperial_execution") }) }),
  punishmentBaseSchema.extend({
    targetKind: z.literal("consort"),
    kind: z.literal("strip_harem_authority"),
    details: z.strictObject({
      fromMode: z.literal("empress"),
      initialTarget: z.discriminatedUnion("mode", [
        z.strictObject({ mode: z.literal("acting_consort"), charId: z.string() }),
        z.strictObject({ mode: z.literal("neiwu_proxy") }),
      ]),
    }),
  }),
  punishmentBaseSchema.extend({ targetKind: z.literal("official"), kind: z.literal("official_demotion"), lifecycle: immediatePunishmentLifecycleSchema, details: z.strictObject({ fromPostId: z.string(), toPostId: z.string() }) }),
  punishmentBaseSchema.extend({ targetKind: z.literal("official"), kind: z.literal("official_dismissal"), lifecycle: immediatePunishmentLifecycleSchema, details: z.strictObject({ fromPostId: z.string() }) }),
]);

const justiceNextSeqSchema = z.strictObject({
  case: z.number().int().min(1),
  punishment: z.number().int().min(1),
  charge: z.number().int().min(1),
  evidence: z.number().int().min(1),
  confession: z.number().int().min(1),
  verdict: z.number().int().min(1),
});

const justiceStateSchema = z.strictObject({
  cases: z.record(z.string(), caseRecordSchema),
  punishments: z.record(z.string(), punishmentRecordSchema),
  nextSeq: justiceNextSeqSchema,
}).superRefine((data, ctx) => {
  const errs = validateJusticeState(data as Parameters<typeof validateJusticeState>[0]);
  for (const e of errs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e.message });
  }
});

export const gameStateSchema = z.strictObject({
  calendar: calendarStateSchema,
  playerLocation: z.string(),
  resources: z.strictObject({
    sovereign: z.strictObject({
      health: percent,
      healthStatus: z.enum(["healthy", "sick", "critical"]),
      lastPhysicianVisitMonthKey: z.string().optional(),
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
      lastRiteAt: gameTimeSchema.optional(),
      pregnancy: z.strictObject({
        status: z.enum(["none", "pending", "carrying"]),
        conceivedAt: gameTimeSchema.optional(),
        candidateIds: z.array(idSchema),
      }),
      gestations: z.array(
        z.strictObject({
          carrier: z.union([z.literal("sovereign"), idSchema]),
          conceivedAt: gameTimeSchema,
          fatherId: idSchema.optional(),
          transferredAtMonth: z.number().int().min(1).optional(),
        }),
      ),
      heirs: z.array(
        z.strictObject({
          id: idSchema,
          sex: z.enum(["daughter", "son"]),
          fatherId: z.union([idSchema, z.null()]),
          bearer: z.union([z.literal("sovereign"), idSchema]),
          birthAt: gameTimeSchema,
          favor: percent,
          legitimate: z.boolean(),
          petName: z.string().max(2),
          givenName: z.string().max(2).optional(),
          education: z.strictObject({
            scholarship: percent,
            martial: percent,
            virtue: percent,
          }),
          adoptiveFatherId: idSchema.optional(),
          health: percent,
          talent: percent,
          diligence: percent,
          ambition: percent,
          closeness: percent,
          support: percent,
          faction: z.enum([
            "none",
            "empress",
            "adoptive",
            "maternal",
            "scholars",
            "generals",
            "clan",
            "wavering",
            "foreign",
          ]),
          lifecycle: z.enum(["alive", "deceased"]),
          deceasedAt: gameTimeSchema.optional(),
          healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
          lastPhysicianVisitMonthKey: z.string().optional(),
        }).superRefine((h, ctx) => {
          if (h.lifecycle === "alive" && h.deceasedAt !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "alive heir must not have deceasedAt", path: ["deceasedAt"] });
          }
          if (h.lifecycle === "deceased" && h.deceasedAt === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deceased heir must have deceasedAt", path: ["deceasedAt"] });
          }
        }),
      ),
    }),
    storehouse: z.strictObject({
      items: z.record(idSchema, z.number().int().min(0)),
    }),
  }),
  flags: z.record(z.string(), flagValueSchema),
  // characterStandingSchema already includes the new optional fields
  // (fear, ambition, loyalty, haremFactionId) added in v11.
  standing: z.record(idSchema, characterStandingSchema),
  generatedConsorts: z.record(idSchema, characterSchema),
  officials: z.record(z.string(), officialSchema),
  officialFamilies: z.record(idSchema, officialFamilySchema),
  familyMembers: z.record(idSchema, familyMemberSchema),
  kinship: z.array(kinshipSchema),
  pendingRetirements: z.array(pendingRetirementSchema),
  officialHistory: z.array(officialHistorySchema),
  officialCandidates: z.record(idSchema, officialCandidateSchema),
  examinationResults: z.array(examinationResultSchema),
  annualReviews: z.array(annualReviewRecordSchema),
  memories: z.record(
    idSchema,
    z.strictObject({ entries: z.array(memoryEntrySchema), nextSeq: z.number().int().min(1) }),
  ),
  bedchamber: z.record(
    idSchema,
    z.strictObject({
      encounters: z.array(
        z.strictObject({ at: gameTimeSchema, mode: z.enum(["passion", "pleasure", "companionship"]) }),
      ),
    }),
  ),
  taihou: z.strictObject({
    health: percent,
    healthStatus: z.enum(["healthy", "sick", "critical"]),
    lastPhysicianVisitMonthKey: z.string().optional(),
    deceased: z.boolean().optional(),
    diedAt: gameTimeSchema.optional(),
    posthumousName: z.string().min(1).max(2).optional(),
    mourningUntilDayExclusive: z.number().int().min(0).optional(),
  }),
  eventLog: z.array(z.strictObject({ eventId: idSchema, firedAt: gameTimeSchema })),
  chronicle: z.array(
    z.strictObject({
      id: courtEventIdSchema,
      type: z.enum([
        "residence_changed", "heir_born", "heir_died", "rank_changed",
        "punished", "rewarded", "conflict", "promise", "secret_discovered",
        "harem_administration_changed",
      ]),
      occurredAt: gameTimeSchema,
      participants: z.array(z.strictObject({ charId: idSchema, role: z.string().min(1) })),
      locationId: idSchema.optional(),
      payload: z.record(z.string(), z.unknown()),
      publicity: z.discriminatedUnion("scope", [
        z.strictObject({ scope: z.literal("circle"), circleIds: z.array(idSchema) }),
        z.strictObject({ scope: z.literal("palace"), persistence: z.enum(["contemporaneous", "institutional"]) }),
        z.strictObject({ scope: z.literal("realm"), persistence: z.literal("institutional") }),
      ]),
      publicSalience: percent,
      retention: z.enum(["fast", "slow", "permanent"]),
      tags: z.array(z.string()),
      links: z.strictObject({
        caseId: z.string().regex(/^case_\d{6}$/).optional(),
        punishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
        sourcePunishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
      }).refine(
        (l) => l.caseId !== undefined || l.punishmentId !== undefined || l.sourcePunishmentId !== undefined,
        { message: "links must contain at least one field" },
      ).optional(),
    }),
  ),
  statusEffects: z.array(statusEffectSchema).default([]),
  emotionalConditions: z.array(
    z.strictObject({
      id: z.string().min(1),
      ownerId: idSchema,
      type: z.enum(["acute_grief","prolonged_grief","resentment","anxiety","infatuation","humiliation"]),
      sourceEventId: z.string().min(1),
      severity: percent,
      startedAt: gameTimeSchema,
      recoveryProfile: z.enum(["fast","normal","slow","stuck"]),
    }),
  ),
  mentionLog: z.array(z.strictObject({
    speakerId: idSchema, audienceId: idSchema, memoryId: z.string().min(1), mentionedAt: gameTimeSchema,
  })),
  eventReactionLog: z.array(z.strictObject({
    speakerId: idSchema, audienceId: idSchema, eventId: z.string().min(1), reactedAt: gameTimeSchema,
  })),
  sceneHistory: z.array(idSchema),
  pendingAftermath: z.array(
    z.strictObject({
      id: nonEmpty,
      kind: z.enum(["taihou", "consort", "heir"]),
      subjectId: idSchema,
      at: gameTimeSchema,
      resolved: z.boolean(),
    }),
  ),
  pendingDaxuan: z.strictObject({ kind: z.enum(["announce", "dianxuan"]), year: z.number() }).optional(),
  gameOver: z.strictObject({ cause: z.literal("sovereign_death"), at: gameTimeSchema }).optional(),
  haremAdministration: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("empress") }),
    z.strictObject({
      mode: z.literal("acting_consort"),
      charId: idSchema,
      appointedAt: gameTimeSchema,
      reason: z.enum([
        "empress_confined",
        "empress_illness",
        "imperial_deprivation",
        "no_eligible_consort",
        "imperial_reassignment",
      ]),
    }),
    z.strictObject({
      mode: z.literal("neiwu_proxy"),
      appointedAt: gameTimeSchema,
      reason: z.enum([
        "empress_confined",
        "empress_illness",
        "imperial_deprivation",
        "no_eligible_consort",
        "imperial_reassignment",
      ]),
    }),
  ]).default({ mode: "empress" }),
  justice: justiceStateSchema,
  rngSeed: z.number(),
}).superRefine((data, ctx) => {
  const errs = validateJusticeLinks(data as Parameters<typeof validateJusticeLinks>[0]);
  for (const e of errs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e.message });
  }
}) satisfies z.ZodType<GameState>;

/** Envelope checked BEFORE the state payload (checksum gates the inside). */
export const saveEnvelopeSchema = z.strictObject({
  formatVersion: z.number().int().min(1),
  engineVersion: z.string(),
  contentVersion: z.string(),
  contentHash: z.string(),
  createdAt: z.string(),
  slot: z.string(),
  checksum: z.string(),
  state: z.unknown(),
});
export type SaveEnvelope = z.infer<typeof saveEnvelopeSchema>;
