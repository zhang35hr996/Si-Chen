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
import { validateColdPalaceIncidentLinks, validateColdPalaceInterventionLinks, validateColdPalaceMadnessLinks } from "../characters/coldPalaceValidator";
import { validateHaremDisciplineLinks } from "../characters/haremDisciplineValidator";
import { validatePeakFavor } from "../characters/peakFavorValidator";
import { validateCompanionWorld } from "../characters/companionValidator";
import { validateHaremIntrigueLinks } from "../characters/haremIntrigue/stateValidation";
import { validateHaremInvestigationLinks, validateInvestigationPublicReports } from "../characters/haremInvestigation/stateValidation";
import { validateInvestigationIncidents, validateInvestigationTruths } from "../characters/haremInvestigation/truth/stateValidation";

const nonEmpty = z.string().min(1);

const percent = z.number().int().min(0).max(100);

export const courtEventIdSchema = z.string().regex(/^evt_\d{6}$/);

export const gameTimeSchema = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().min(0),
});

// 调查方法（旧宫斗 3 种 + 5B-2B2a 证据 6 种）。与 InvestigationMethod 保持同步。
const investigationMethodEnum = z.enum([
  "question_target", "question_suspect", "quiet_inquiry",
  "medical_examination", "question_servants", "reconstruct_timeline",
  "search_quarters", "trace_money", "obtain_testimony",
]);

const investigationCauseTypeEnum = z.enum([
  "natural_illness", "accident", "negligence", "intentional_harm", "framing", "false_accusation",
]);
const incidentMechanismEnum = z.enum([
  "none", "wrong_dosage", "tampered_medicine", "hallucinogenic_herb", "fabricated_testimony",
  "induced_symptoms", "contaminated_medicine", "treatment_delay", "medicine_mixup",
]);

// 玩家知识层线索结论（5B-2B2a）。与 InvestigationLeadClaim 保持同步。
const investigationLeadClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("implicates_character"), characterId: idSchema, strength: z.enum(["weak", "moderate", "strong"]) }),
  z.strictObject({ kind: z.literal("exonerates_character"), characterId: idSchema, strength: z.enum(["weak", "moderate", "strong"]) }),
  z.strictObject({ kind: z.literal("supports_cause"), causeType: investigationCauseTypeEnum }),
  z.strictObject({ kind: z.literal("reveals_mechanism"), mechanism: incidentMechanismEnum }),
  z.strictObject({ kind: z.literal("establishes_fact"), factCode: z.string().min(1) }),
]);

// 伴读/宗室共用子 schema（HeirPersonality 六维 + 伴读人物引用）。
const companionPersonalitySchema = z.object({
  empathy: percent,
  guile: percent,
  restraint: percent,
  sociability: percent,
  assertiveness: percent,
  curiosity: percent,
});
const companionRefSchema = z.union([
  z.object({ kind: z.literal("family_member"), personId: z.string().min(1) }),
  z.object({ kind: z.literal("royal_relative"), personId: z.string().min(1) }),
]);

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
  dismissalCandidateIds: z.array(idSchema).optional(),
});

const personnelDecisionSchema = z.strictObject({
  id: z.string().regex(/^pdec_\d{6}$/),
  kind: z.enum([
    "consort_petition_promotion",
    "family_implication",
    "memorial_promotion",
    "memorial_demotion",
    "memorial_dismissal",
  ]),
  status: z.enum(["pending", "resolved"]),
  createdAt: gameTimeSchema,
  sourceId: z.string().min(1),
  officialId: idSchema,
  consortId: idSchema.optional(),
  familyId: idSchema.optional(),
  fromPostId: idSchema.optional(),
  recommendedPostId: idSchema.optional(),
  sourcePunishmentId: z.string().regex(/^pun_\d{6}$/).optional(),
  caseId: z.string().regex(/^case_\d{6}$/).optional(),
  resolvedAt: gameTimeSchema.optional(),
  resolution: z.enum(["approve", "reject", "spare", "demote", "dismiss"]).optional(),
});

// ── 奏折框架（Phase 4A/4B） ──
const memorialResourceEffectSchema = z.strictObject({
  type: z.literal("resource"),
  pillar: z.enum(["sovereign", "nation"]),
  field: z.string().min(1),
  delta: z.number().int(),
});
/** 通用奏折选项（Phase 4B：增加可选 treasuryDelta）。 */
const memorialOptionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  effects: z.array(memorialResourceEffectSchema),
  treasuryDelta: z.number().int().refine((n) => n !== 0, "treasuryDelta must be nonzero").optional(),
});
const frontierTheaterIdSchema = z.enum(["northern_frontier", "western_frontier", "southern_frontier"]);

const frontierAssessmentSchema = z.strictObject({
  id: z.string().min(1),
  year: z.number().int().min(1),
  assessedAt: gameTimeSchema,
  theaterId: frontierTheaterIdSchema,
  pressureBefore: z.number().int().min(0).max(100),
  pressureDelta: z.number().int(),
  pressureAfter: z.number().int().min(0).max(100),
  militaryAtAssessment: z.number().int().min(0).max(100),
  governanceAtAssessment: z.number().int().min(0).max(100),
  publicSupportAtAssessment: z.number().int().min(0).max(100),
  severity: z.enum(["stable", "watch", "urgent", "critical"]),
  generation: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("generated"), memorialId: z.string().min(1) }),
    z.strictObject({ status: z.literal("blocked_by_pending"), blockingMemorialId: z.string().min(1) }),
  ]),
});

const memorialPayloadSchema = z.union([
  z.strictObject({
    category: z.literal("disaster"),
    regionId: z.string().min(1),
    severity: z.enum(["minor", "major"]),
    options: z.array(memorialOptionSchema).min(1),
  }),
  z.strictObject({
    category: z.literal("treasury"),
    matter: z.literal("annual_revenue_plan"),
    urgency: z.enum(["routine", "urgent"]),
    options: z.array(memorialOptionSchema).min(1),
  }),
  z.strictObject({
    category: z.literal("treasury"),
    matter: z.literal("quarterly_settlement_report"),
    season: z.string().min(1),
    periodKey: z.string().min(1),
    openingTreasury: z.number().int().min(0),
    revenueBase: z.number().int().min(0),
    revenueActual: z.number().int().min(0),
    revenueCauses: z.array(z.strictObject({
      type: z.enum(["productivity", "corruption", "public_support", "border_pressure", "random"]),
      impact: z.number().int(),
    })),
    expensePlanned: z.number().int().min(0),
    expensePaid: z.number().int().min(0),
    fundingShortfall: z.number().int().min(0),
    expenseAllocation: z.strictObject({
      planned: z.strictObject({ palace: z.number().int().min(0), consortAllowance: z.number().int().min(0), officialSalary: z.number().int().min(0), armyMaintenance: z.number().int().min(0), royalChildrenEducation: z.number().int().min(0) }),
      paid:    z.strictObject({ palace: z.number().int().min(0), consortAllowance: z.number().int().min(0), officialSalary: z.number().int().min(0), armyMaintenance: z.number().int().min(0), royalChildrenEducation: z.number().int().min(0) }),
      shortfall: z.strictObject({ palace: z.number().int().min(0), consortAllowance: z.number().int().min(0), officialSalary: z.number().int().min(0), armyMaintenance: z.number().int().min(0), royalChildrenEducation: z.number().int().min(0) }),
    }),
    closingTreasury: z.number().int().min(0),
    options: z.array(memorialOptionSchema).min(1),
  }),
  z.strictObject({
    category: z.literal("military"),
    matter: z.enum(["annual_readiness", "border_fortification", "frontier_incursion"]),
    urgency: z.enum(["routine", "urgent", "critical"]),
    theaterId: frontierTheaterIdSchema,
    pressureAtCreation: z.number().int().min(0).max(100),
    militaryAtCreation: z.number().int().min(0).max(100),
    options: z.array(memorialOptionSchema).min(1),
  }),
]);
// ── 国库台账（Phase 4B） ─────────────────────────────────────────────────────
const treasuryLedgerSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("memorial"), memorialId: z.string().min(1), optionId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("shop_purchase"), itemId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("system"), reasonCode: z.string().min(1) }),
]);
const treasuryLedgerEntrySchema = z.strictObject({
  id: z.string().regex(/^tre_\d{6}$/),
  at: gameTimeSchema,
  delta: z.number().int().refine((n) => n !== 0, "delta must be nonzero"),
  balanceBefore: z.number().int().min(0),
  balanceAfter: z.number().int().min(0),
  source: treasuryLedgerSourceSchema,
  reason: z.string().min(1),
});

const memorialSchema = z.strictObject({
  id: z.string().regex(/^mem_\d{6}$/),
  category: z.enum(["personnel", "treasury", "disaster", "military", "justice"]),
  status: z.enum(["pending", "resolved"]),
  createdAt: gameTimeSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  payload: memorialPayloadSchema,
  resolvedAt: gameTimeSchema.optional(),
  resolution: z.string().min(1).optional(),
});

const flagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

/** 禁足效果 schema。活跃判定见 characters/confinement.ts，不存「剩余月份」。 */
const confinementEffectSchema = z.strictObject({
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

/** 冷宫效果 schema。 */
const coldPalaceEffectSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("cold_palace"),
  characterId: idSchema,
  startedAt: gameTimeSchema,
  startTurn: z.number().int().min(0),
  previousResidenceId: z.string().min(1),
  previousChamber: z.enum(["main", "east_side", "west_side", "east_annex", "west_annex"]).optional(),
  coldPalaceResidenceId: z.string().min(1),
  sourcePunishmentId: z.string().regex(/^pun_\d{6}$/),
  liftedAt: gameTimeSchema.optional(),
  liftedTurn: z.number().int().min(0).optional(),
  liftReason: z.enum(["lifted_by_emperor", "pardoned", "death"]).optional(),
});

const coldPalaceMadnessEffectSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.literal("cold_palace_madness"),
  characterId: idSchema,
  sourceColdPalaceEffectId: z.string().min(1),
  startedAt: gameTimeSchema,
  startTurn: z.number().int().min(0),
});

/** 角色持续状态（禁足/冷宫等）。 */
const statusEffectSchema = z.discriminatedUnion("kind", [
  confinementEffectSchema,
  coldPalaceEffectSchema,
  coldPalaceMadnessEffectSchema,
]);

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
  punishmentBaseSchema.extend({ targetKind: z.literal("consort"), kind: z.literal("cold_palace"), details: z.strictObject({ statusEffectId: z.string(), previousResidenceId: z.string(), previousChamber: z.enum(["main", "east_side", "west_side", "east_annex", "west_annex"]).optional(), coldPalaceResidenceId: z.string() }) }),
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

// ── Investigation truth layer (Phase 5B-2A) ───────────────────────────────────

const investigationCauseTypeSchema = z.enum([
  "natural_illness",
  "accident",
  "negligence",
  "intentional_harm",
  "framing",
  "false_accusation",
]);

const investigationMethodSchema = z.enum([
  "none",
  "wrong_dosage",
  "tampered_medicine",
  "hallucinogenic_herb",
  "fabricated_testimony",
  "induced_symptoms",        // kept for backwards compat; no longer generated
  "contaminated_medicine",
  "treatment_delay",
  "medicine_mixup",
]);

const investigationMotiveSchema = z.enum([
  "none",
  "succession_rivalry",
  "jealousy",
  "personal_grievance",
  "frame_rival",
  "conceal_negligence",
]);

const evidenceTypeSchema = z.enum([
  "medical",
  "physical",
  "testimony",
  "financial",
  "timeline",
  "correspondence",
]);

const investigationActionTypeSchema = z.enum([
  "medical_examination",
  "question_servants",
  "reconstruct_timeline",
  "trace_money",
  "search_quarters",
  "obtain_testimony",
]);

const evidenceClaimSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("implicates_character"),
    characterRef: z.string(),
    strength: z.enum(["weak", "moderate", "strong"]),
  }),
  z.object({
    kind: z.literal("exonerates_character"),
    characterRef: z.string(),
    strength: z.enum(["weak", "moderate", "strong"]),
  }),
  z.object({
    kind: z.literal("supports_cause"),
    causeType: investigationCauseTypeSchema,
  }),
  z.object({
    kind: z.literal("reveals_method"),
    method: investigationMethodSchema,
  }),
  z.object({
    kind: z.literal("establishes_fact"),
    factCode: z.string(),
  }),
]);

const hiddenEvidenceNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: evidenceTypeSchema,
  factCode: z.string().min(1),
  claims: z.array(evidenceClaimSchema),
  difficulty: z.number().int().min(0).max(100),
  decayPerPeriod: z.number().int().min(0),
  discoverableBy: z.array(investigationActionTypeSchema),
  prerequisiteEvidenceIds: z.array(z.string().min(1)),
  misleading: z.boolean(),
});

const investigationTruthSchema = z.strictObject({
  id: z.string().min(1),
  incidentId: z.string().min(1),
  eventFamily: z.literal("heir_health_anomaly"),
  causeType: investigationCauseTypeSchema,
  culpritIds: z.array(z.string().min(1)),
  accusedIds: z.array(z.string().min(1)),
  framingTargetIds: z.array(z.string().min(1)),
  method: investigationMethodSchema,
  motive: investigationMotiveSchema,
  concealment: z.number().int().min(0).max(100),
  evidenceNodes: z.array(hiddenEvidenceNodeSchema),
  generatedAt: gameTimeSchema,
  sourceKey: z.string().min(1),
});

const heirHealthAnomalyIncidentSchema = z.strictObject({
  id: z.string().min(1),
  eventFamily: z.literal("heir_health_anomaly"),
  occurredAt: gameTimeSchema,
  sourceKey: z.string().min(1),
  victimHeirId: z.string().min(1),
  custodianId: z.string().optional(),
  accuserIds: z.array(idSchema),
  initiallyAccusedIds: z.array(idSchema),
  symptom: z.enum(["hysteria", "acute_pain", "high_fever", "convulsions", "excessive_drowsiness"]),
  publicFactCodes: z.array(z.string()),
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
      borderPressure: z.number().int().min(0).max(100).default(35),
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
          personality: z.strictObject({
            empathy: percent,
            guile: percent,
            restraint: percent,
            sociability: percent,
            assertiveness: percent,
            curiosity: percent,
          }),
          interests: z.array(z.enum([
            "books", "statecraft", "riding", "music", "dance",
            "needlework", "calligraphy", "animals", "outdoors",
            "games", "socializing",
          ])),
          imperialFear: percent,
          neglect: percent,
          custodianBond: percent,
          lastImperialInteractionAt: gameTimeSchema.optional(),
          portraitVariants: z.strictObject({
            baby: z.string().min(1),
            kid: z.string().min(1),
            child: z.string().min(1),
            teen: z.string().min(1),
          }),
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
  personnelDecisions: z.record(z.string(), personnelDecisionSchema),
  memorials: z.record(z.string(), memorialSchema),
  treasuryLedger: z.array(treasuryLedgerEntrySchema).default([]),
  frontierAssessments: z.array(frontierAssessmentSchema).default([]),
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
        "harem_administration_changed", "heir_custody_changed", "intrigue_discovered",
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
  coldPalaceInterventions: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("personal_visit"),
        occurredAt: gameTimeSchema,
        favorDelta: z.number().int().positive(),
      }),
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("physician"),
        occurredAt: gameTimeSchema,
        healthDelta: z.number().int().positive(),
      }),
    ]),
  ).default([]),
  coldPalaceIncidents: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("petition"),
        occurredAt: gameTimeSchema,
        acknowledged: z.boolean(),
      }),
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("health_deterioration"),
        occurredAt: gameTimeSchema,
        acknowledged: z.boolean(),
        healthDelta: z.number().int(),
      }),
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("critical_illness"),
        occurredAt: gameTimeSchema,
        acknowledged: z.boolean(),
        status: z.enum(["pending_response", "resolved"]),
        resolution: z.enum(["physician", "ignore", "restored"]).optional(),
        resolvedAt: gameTimeSchema.optional(),
        healthDelta: z.number().int().optional(),
      }),
      z.strictObject({
        id: nonEmpty,
        residentId: idSchema,
        effectId: nonEmpty,
        kind: z.literal("mental_breakdown"),
        occurredAt: gameTimeSchema,
        acknowledged: z.boolean(),
        madnessEffectId: z.string().min(1),
      }),
    ]),
  ).default([]),
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
  haremSchemes: (z.array(z.strictObject({
    id: z.string().min(1),
    sourceKey: z.string().regex(/^harem_intrigue:\d+:\d{2}$/),
    plan: z.strictObject({
      sourceKey: z.string().min(1),
      plannedAt: gameTimeSchema,
      year: z.number().int().positive(),
      month: z.number().int().min(1).max(12),
      actorId: idSchema,
      targetId: idSchema,
      kind: z.enum(["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"]),
      motive: z.enum(["jealousy", "ambition", "resentment", "fear", "faction"]),
      actorPropensity: z.number().int().min(0).max(100),
      targetThreat: z.number().int().min(0).max(100),
      priority: z.number().int().min(0).max(100),
      potency: z.number().int().min(10).max(90),
      secrecy: z.number().int().min(10).max(90),
      grievanceStrength: z.number().int().min(0).max(100),
      factionConflict: z.boolean(),
      actorSnapshot: z.strictObject({
        characterId: idSchema,
        rankId: idSchema,
        rankOrder: z.number().int(),
        favor: z.number().int().min(0).max(100),
        peakFavor: z.number().int().min(0).max(100),
        affection: z.number().int().min(0).max(100),
        fear: z.number().int().min(0).max(100),
        ambition: z.number().int().min(0).max(100),
        loyalty: z.number().int().min(0).max(100),
        factionId: z.string().optional(),
        personality: z.strictObject({
          scheming: z.number().int().min(0).max(100),
          sociability: z.number().int().min(0).max(100),
          compassion: z.number().int().min(0).max(100),
          courage: z.number().int().min(0).max(100),
          jealousy: z.number().int().min(0).max(100),
          emotionalStability: z.number().int().min(0).max(100),
          pride: z.number().int().min(0).max(100),
          intelligence: z.number().int().min(0).max(100),
        }),
        household: z.strictObject({
          servantOpinion: z.number().int().min(0).max(100),
          livingStandard: z.number().int().min(0).max(100),
          privateWealthLevel: z.number().int().min(0).max(100),
        }),
      }),
      targetSnapshot: z.strictObject({
        characterId: idSchema,
        rankId: idSchema,
        rankOrder: z.number().int(),
        favor: z.number().int().min(0).max(100),
        peakFavor: z.number().int().min(0).max(100),
        affection: z.number().int().min(0).max(100),
        fear: z.number().int().min(0).max(100),
        ambition: z.number().int().min(0).max(100),
        loyalty: z.number().int().min(0).max(100),
        factionId: z.string().optional(),
        personality: z.strictObject({
          scheming: z.number().int().min(0).max(100),
          sociability: z.number().int().min(0).max(100),
          compassion: z.number().int().min(0).max(100),
          courage: z.number().int().min(0).max(100),
          jealousy: z.number().int().min(0).max(100),
          emotionalStability: z.number().int().min(0).max(100),
          pride: z.number().int().min(0).max(100),
          intelligence: z.number().int().min(0).max(100),
        }),
        household: z.strictObject({
          servantOpinion: z.number().int().min(0).max(100),
          livingStandard: z.number().int().min(0).max(100),
          privateWealthLevel: z.number().int().min(0).max(100),
        }),
      }),
      rationale: z.array(z.enum([
        "high_jealousy", "high_ambition", "high_scheming", "unresolved_grievance",
        "favor_gap", "peak_favor_gap", "rank_rivalry", "faction_conflict",
        "household_leverage", "low_loyalty", "fear_pressure", "target_influence",
      ])),
    }),
    status: z.enum(["pending", "resolved", "cancelled"]),
    outcome: z.union([
      z.strictObject({
        status: z.literal("resolved"),
        resolvedAt: gameTimeSchema,
        successRoll: z.number(),
        successThreshold: z.number(),
        success: z.boolean(),
        discoveryRoll: z.number(),
        discoveryThreshold: z.number(),
        discovered: z.boolean(),
        consequences: z.strictObject({
          standing: z.array(z.strictObject({
            characterId: idSchema,
            favor: z.number().int().optional(),
            affection: z.number().int().optional(),
            fear: z.number().int().optional(),
            loyalty: z.number().int().optional(),
          })),
          household: z.array(z.strictObject({
            characterId: idSchema,
            servantOpinion: z.number().int().optional(),
            livingStandard: z.number().int().optional(),
            privateWealthLevel: z.number().int().optional(),
          })),
          nation: z.strictObject({ rumor: z.number().int().optional() }),
        }),
        knowledge: z.strictObject({
          actorKnowsOwnAction: z.literal(true),
          targetKnowsInstigator: z.boolean(),
          palacePublic: z.boolean(),
        }),
      }),
      z.strictObject({
        status: z.literal("cancelled"),
        resolvedAt: gameTimeSchema,
        reason: z.enum(["actor_unavailable", "target_unavailable", "actor_target_same"]),
        consequences: z.strictObject({
          standing: z.tuple([]),
          household: z.tuple([]),
          nation: z.strictObject({}),
        }),
        knowledge: z.strictObject({
          actorKnowsOwnAction: z.literal(true),
          targetKnowsInstigator: z.literal(false),
          palacePublic: z.literal(false),
        }),
      }),
    ]).optional(),
    scheduledForYear: z.number().int().positive(),
    scheduledForMonth: z.number().int().min(1).max(12),
  })).default([])) as unknown as z.ZodType<import("../state/types").HaremScheme[]>,
  haremIncidents: z.array(z.strictObject({
    id: z.string().min(1),
    schemeId: z.string().min(1),
    kind: z.enum(["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"]),
    actorId: idSchema,
    targetId: idSchema,
    success: z.boolean(),
    observationLevel: z.enum(["none", "anomaly", "rumor", "exposed"]),
    resolvedAt: gameTimeSchema,
    consequencesApplied: z.boolean(),
    courtEventId: z.string().optional(),
  })).default([]),
  haremIntrigueReports: z.array(z.strictObject({
    id: z.string().min(1),
    source: z.strictObject({ incidentId: z.string().min(1) }),
    reportKind: z.enum(["anomaly", "rumor", "exposure", "investigation_update", "investigation_final"]),
    createdAt: gameTimeSchema,
    status: z.enum(["unread", "acknowledged", "actioned", "archived"]),
    knownTargetIds: z.array(idSchema),
    suspectedActorIds: z.array(idSchema),
    suspectedKinds: z.array(z.enum(["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"])),
    knownOutcome: z.enum(["unknown", "harm_observed", "attempt_observed"]),
    confidence: z.enum(["tenuous", "plausible", "strong", "confirmed"]),
    summaryCode: z.string().min(1),
    acknowledgedAt: gameTimeSchema.optional(),
    action: z.enum(["dismissed", "watching", "investigating", "summoned"]).optional(),
    linkedInvestigationId: z.string().optional(),
  })).default([]),
  haremInvestigationCases: z.array(z.strictObject({
    id: z.string().min(1),
    source: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("legacy_intrigue"),
        reportId: z.string().min(1),
        incidentId: z.string().min(1),
      }),
      z.strictObject({
        kind: z.literal("investigation_incident"),
        reportId: z.string().min(1),
        incidentId: z.string().min(1),
      }),
    ]),
    openedAt: gameTimeSchema,
    openedFromReportKind: z.enum(["anomaly", "rumor", "exposure"]),
    status: z.enum(["open", "in_progress", "ready_for_review", "closed_unresolved", "closed_confirmed", "closed_explained", "cancelled"]),
    knownTargetIds: z.array(idSchema),
    suspectIds: z.array(idSchema),
    suspectedKinds: z.array(z.enum(["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"])),
    confidence: z.enum(["tenuous", "plausible", "strong", "confirmed"]),
    leadIds: z.array(z.string()),
    closedAt: gameTimeSchema.optional(),
    closureReason: z.enum(["player_cancelled", "insufficient_evidence", "culprit_confirmed", "benign_cause_confirmed"]).optional(),
    confirmedCulpritId: idSchema.optional(),
    confirmedBenignCause: z.enum(["natural_illness", "accident"]).optional(),
  })).default([]),
  haremInvestigationTasks: z.record(z.string().regex(/^itask_\d{6}$/), z.strictObject({
    id: z.string().regex(/^itask_\d{6}$/),
    caseId: z.string().min(1),
    method: investigationMethodEnum,
    subjectId: idSchema.optional(),
    requestedAt: gameTimeSchema,
    dueAt: gameTimeSchema,
    status: z.enum(["pending", "resolved", "cancelled"]),
    resolvedAt: gameTimeSchema.optional(),
    leadId: z.string().optional(),
  })).default({}),
  haremInvestigationLeads: z.record(z.string().regex(/^ilead_\d{6}$/), z.strictObject({
    id: z.string().regex(/^ilead_\d{6}$/),
    caseId: z.string().min(1),
    discoveredAt: gameTimeSchema,
    method: investigationMethodEnum,
    summaryCode: z.string().min(1),
    strength: z.enum(["tenuous", "plausible", "strong", "confirmed"]),
    implicatedIds: z.array(idSchema),
    clearedIds: z.array(idSchema),
    revealedKinds: z.array(z.enum(["slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion"])),
    // 5B-2B2a 证据驱动可选扩展（旧存档无此字段）
    sourceEvidenceNodeId: z.string().min(1).optional(),
    claims: z.array(investigationLeadClaimSchema).optional(),
  })).default({}),
  haremInvestigationNextSeq: z.number().int().min(1).default(1),
  investigationIncidents: z.array(heirHealthAnomalyIncidentSchema).default([]),
  investigationTruths: z.array(investigationTruthSchema).default([]),
  investigationPublicReports: z.array(z.discriminatedUnion("reportKind", [
    // 立案报告（5B-2B1）
    z.strictObject({
      id: z.string().min(1),
      source: z.strictObject({
        kind: z.literal("investigation_incident"),
        incidentId: z.string().min(1),
      }),
      reportKind: z.literal("anomaly"),
      eventFamily: z.literal("heir_health_anomaly"),
      createdAt: gameTimeSchema,
      status: z.enum(["unread", "acknowledged", "investigating"]),
      knownTargetIds: z.array(idSchema),
      suspectedActorIds: z.array(idSchema),
      confidence: z.enum(["tenuous", "plausible", "strong", "confirmed"]),
      symptomCode: z.enum(["hysteria", "acute_pain", "high_fever", "convulsions", "excessive_drowsiness"]),
      publicFactCodes: z.array(z.string().min(1)),
      accuserIds: z.array(idSchema),
      acknowledgedAt: gameTimeSchema.optional(),
      linkedInvestigationId: z.string().optional(),
    }),
    // 进展通报（5B-2B2a）
    z.strictObject({
      id: z.string().min(1),
      source: z.strictObject({
        kind: z.literal("investigation_incident"),
        incidentId: z.string().min(1),
      }),
      reportKind: z.enum(["investigation_update", "investigation_final"]),
      createdAt: gameTimeSchema,
      status: z.enum(["unread", "acknowledged"]),
      linkedInvestigationId: z.string().min(1),
      knownTargetIds: z.array(idSchema),
      suspectedActorIds: z.array(idSchema),
      confidence: z.enum(["tenuous", "plausible", "strong", "confirmed"]),
      summaryCode: z.string().min(1),
      acknowledgedAt: gameTimeSchema.optional(),
    }),
  ])).default([]),
  settledHaremIntriguePeriods: z.array(z.string().regex(/^harem_intrigue_settlement:\d+:\d{2}$/)).default([]),
  haremDisciplineIncidents: z.array(z.strictObject({
    id: idSchema,
    actorId: idSchema,
    targetId: idSchema,
    disciplineKind: z.enum(["copy_scripture", "kneeling", "slapping"]),
    occurredAt: gameTimeSchema,
    actorSnapshot: z.strictObject({
      rankId: idSchema,
      favor: z.number().int().min(0).max(100),
      peakFavor: z.number().int().min(0).max(100),
      imperialProtectionScore: z.number().int(),
      isHaremAdministrator: z.boolean(),
    }),
    targetSnapshot: z.strictObject({
      rankId: idSchema,
      favor: z.number().int().min(0).max(100),
      peakFavor: z.number().int().min(0).max(100),
      imperialProtectionScore: z.number().int(),
      isCarrying: z.boolean(),
      healthBefore: z.number().int().min(0).max(100),
    }),
    courtEventId: z.string(),
    status: z.enum(["pending_response", "resolved"]),
    resolution: z.enum(["upheld", "protected", "rebuked_both"]).optional(),
    resolvedAt: gameTimeSchema.optional(),
    resolutionEventId: z.string().optional(),
  }).superRefine((inc, ctx) => {
    if (inc.status === "resolved" && !inc.resolution) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: resolved 必须有 resolution` });
    }
    if (inc.status === "resolved" && !inc.resolvedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: resolved 必须有 resolvedAt` });
    }
    if (inc.status === "resolved" && !inc.resolutionEventId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: resolved 必须有 resolutionEventId` });
    }
    if (inc.status === "pending_response" && inc.resolution !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: pending_response 不可有 resolution` });
    }
    if (inc.status === "pending_response" && inc.resolvedAt !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: pending_response 不可有 resolvedAt` });
    }
    if (inc.status === "pending_response" && inc.resolutionEventId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremDisciplineIncidents[id=${inc.id}]: pending_response 不可有 resolutionEventId` });
    }
  })).default([]),
  haremAdminReviews: z.array(z.strictObject({
    id: idSchema,
    year: z.number().int().min(1),
    outcome: z.enum(["rank_changed", "no_candidate", "no_administrator"]),
    administratorId: idSchema.optional(),
    office: z.enum(["empress", "acting_consort"]).optional(),
    decision: z.strictObject({
      targetId: idSchema,
      direction: z.enum(["promote", "demote"]),
      fromRankId: idSchema,
      toRankId: idSchema,
      reason: z.enum(["service_merit", "household_order", "disloyalty", "household_disorder"]),
      score: z.number(),
    }).optional(),
    settledAt: gameTimeSchema,
    acknowledged: z.boolean(),
  }).superRefine((r, ctx) => {
    if (r.outcome === "rank_changed") {
      if (!r.administratorId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremAdminReviews[id=${r.id}]: rank_changed 必须有 administratorId` });
      if (!r.office) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremAdminReviews[id=${r.id}]: rank_changed 必须有 office` });
      if (!r.decision) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremAdminReviews[id=${r.id}]: rank_changed 必须有 decision` });
    } else {
      if (!r.acknowledged) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `haremAdminReviews[id=${r.id}]: ${r.outcome} 必须 acknowledged=true` });
    }
  })).default([]),
  justice: justiceStateSchema,
  settledQuarterlyPeriods: z.array(z.string()).default([]),
  settledHeirUpbringingMonths: z.array(z.string()).default([]),
  narrativeLog: z.array(z.object({
    at: gameTimeSchema,
    speakerId: z.string(),
    lines: z.array(z.string()),
  })).optional(),
  royalRelatives: z.record(z.string(), z.object({
    id: nonEmpty,
    name: nonEmpty,
    sex: z.enum(["female", "male"]),
    age: z.number().int().min(0),
    branch: z.enum(["close", "collateral", "distant"]),
    branchPrestige: percent,
    legitimate: z.boolean(),
    personality: companionPersonalitySchema,
    lifecycle: z.enum(["alive", "deceased"]),
    deceasedAt: gameTimeSchema.optional(),
  })).default({}),
  heirCompanions: z.record(z.string(), z.object({
    heirId: nonEmpty,
    companion: companionRefSchema,
    assignedAt: gameTimeSchema,
    status: z.enum(["active", "ended"]),
    endedAt: gameTimeSchema.optional(),
    endReason: z.enum(["heir_left_school", "companion_deceased", "dismissed"]).optional(),
    bond: percent,
    ageAtAssignment: z.number().int().min(0),
    profile: z.object({
      name: nonEmpty,
      sex: z.enum(["female", "male"]),
      legitimate: z.boolean(),
      personality: companionPersonalitySchema,
      familyName: z.string().optional(),
      familyRole: z.string().optional(),
    }),
  })).default({}),
  templateEventNextSeq: z.number().int().min(0).default(0),
  templateEventRecords: z.record(z.string(), z.object({
    id: z.string(),
    templateId: z.string(),
    participants: z.record(z.string(), z.string()),
    hiddenTruthId: z.string(),
    generatedAt: gameTimeSchema,
    status: z.enum(["generated", "resolved"]),
    selectedChoiceId: z.string().optional(),
    resolvedAt: gameTimeSchema.optional(),
  })).default({}),
  rngSeed: z.number(),
}).superRefine((data, ctx) => {
  const errs = [
    ...validateJusticeLinks(data as Parameters<typeof validateJusticeLinks>[0]),
    ...validateHaremDisciplineLinks(data as Parameters<typeof validateHaremDisciplineLinks>[0]),
    ...validateColdPalaceIncidentLinks(data as Parameters<typeof validateColdPalaceIncidentLinks>[0]),
    ...validateColdPalaceInterventionLinks(data as Parameters<typeof validateColdPalaceInterventionLinks>[0]),
    ...validateColdPalaceMadnessLinks(data as Parameters<typeof validateColdPalaceMadnessLinks>[0]),
    ...validatePeakFavor(data as Parameters<typeof validatePeakFavor>[0]),
    ...validateCompanionWorld(data as Parameters<typeof validateCompanionWorld>[0]),
    ...validateHaremIntrigueLinks(data as Parameters<typeof validateHaremIntrigueLinks>[0]),
    ...validateHaremInvestigationLinks({
      haremIntrigueReports: (data as Parameters<typeof validateHaremIntrigueLinks>[0]).haremIntrigueReports,
      haremInvestigationCases: (data as { haremInvestigationCases: Parameters<typeof validateHaremInvestigationLinks>[0]["haremInvestigationCases"] }).haremInvestigationCases,
      haremInvestigationTasks: (data as { haremInvestigationTasks: Parameters<typeof validateHaremInvestigationLinks>[0]["haremInvestigationTasks"] }).haremInvestigationTasks,
      haremInvestigationLeads: (data as { haremInvestigationLeads: Parameters<typeof validateHaremInvestigationLinks>[0]["haremInvestigationLeads"] }).haremInvestigationLeads,
      haremInvestigationNextSeq: (data as { haremInvestigationNextSeq: number }).haremInvestigationNextSeq,
      incidentIds: new Set((data as Parameters<typeof validateHaremIntrigueLinks>[0]).haremIncidents.map((i) => i.id)),
      investigationPublicReports: (data as { investigationPublicReports: Parameters<typeof validateHaremInvestigationLinks>[0]["investigationPublicReports"] }).investigationPublicReports,
      investigationIncidentIds: new Set((data as { investigationIncidents: { id: string }[] }).investigationIncidents.map((i) => i.id)),
      investigationTruths: (data as { investigationTruths: Parameters<typeof validateHaremInvestigationLinks>[0]["investigationTruths"] }).investigationTruths,
    }),
    ...validateInvestigationIncidents({
      investigationIncidents: (data as { investigationIncidents: Parameters<typeof validateInvestigationIncidents>[0]["investigationIncidents"] }).investigationIncidents,
    }),
    ...validateInvestigationTruths({
      investigationTruths: (data as { investigationTruths: Parameters<typeof validateInvestigationTruths>[0]["investigationTruths"] }).investigationTruths,
      investigationIncidents: (data as { investigationIncidents: Parameters<typeof validateInvestigationTruths>[0]["investigationIncidents"] }).investigationIncidents,
      allCharacterIds: new Set([
        ...Object.keys((data as { standing: Record<string, unknown> }).standing),
        ...Object.keys((data as { generatedConsorts: Record<string, unknown> }).generatedConsorts),
      ]),
    }),
    ...validateInvestigationPublicReports({
      reports: (data as { investigationPublicReports: Parameters<typeof validateInvestigationPublicReports>[0]["reports"] }).investigationPublicReports,
      incidents: (data as { investigationIncidents: Parameters<typeof validateInvestigationPublicReports>[0]["incidents"] }).investigationIncidents,
      cases: (data as { haremInvestigationCases: Parameters<typeof validateInvestigationPublicReports>[0]["cases"] }).haremInvestigationCases,
    }),
  ];
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
