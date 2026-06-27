/**
 * Versioned save system (skeleton-plan §9).
 *
 * Load ladder per slot: parse → envelope → version gate → migrations →
 * checksum → state schema → content-id cross-check → contentHash warning.
 * Any corruption quarantines the blob to `sichen.corrupt.<ts>` (user data is
 * never destroyed) and the original key is removed. Future versions are
 * REFUSED but not quarantined. Mid-scene saving is structurally impossible:
 * no save UI is reachable from the dialogue screen, and SceneSessions are
 * never serialized.
 */
import type { ContentDB } from "../content/loader";
import { validateOfficialWorld } from "../officials/validation";
import { validateMemorials } from "../court/memorials";
import { validateTreasuryLedger } from "../court/treasuryLedger";
import { validateFrontierAssessments } from "../court/frontierAssessment";
import { saveError, type GameError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { err, ok, type Result } from "../infra/result";
import type { GameState, Official, OfficialAptitude, TreasuryLedgerEntry, FrontierAssessment } from "../state/types";
import { deriveOfficialAptitude, initialReviewState } from "../officials/careerMetrics";
import { canonicalStringify, checksumOf, fnv1a64Hex } from "./canonical";
import { gameStateSchema, saveEnvelopeSchema, type SaveEnvelope } from "./stateSchema";
import type { KVStorage } from "./storage";

export const SAVE_FORMAT_VERSION = 30;
export const ENGINE_VERSION = "0.1.0";
export const SAVE_KEY_PREFIX = "sichen.save.";
export const CORRUPT_KEY_PREFIX = "sichen.corrupt.";

export const MANUAL_SLOTS = ["slot1", "slot2", "slot3"] as const;
export const ALL_SLOTS = ["auto", "auto.prev", ...MANUAL_SLOTS] as const;
export type SaveSlot = (typeof ALL_SLOTS)[number];

/**
 * Migration chain: vN → vN+1 steps. Each receives the parsed envelope and must
 * return a new envelope with a bumped formatVersion and a recomputed checksum
 * (the checksum gate runs AFTER migrations).
 *
 * v1 → v2: single-line `gestation?` → multi-line `gestations[]`.
 */
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
  1: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bloodline = ((state.resources as Record<string, unknown> | undefined)?.bloodline ??
      {}) as Record<string, unknown>;
    const single = bloodline.gestation;
    delete bloodline.gestation;
    bloodline.gestations = single !== undefined && single !== null ? [single] : [];
    return { ...env, formatVersion: 2, state, checksum: checksumOf(state) };
  },
  2: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bloodline = ((state.resources as Record<string, unknown> | undefined)?.bloodline ??
      {}) as Record<string, unknown>;
    const heirs = (bloodline.heirs as Record<string, unknown>[] | undefined) ?? [];
    for (const h of heirs) {
      if (h.petName === undefined) h.petName = "";
      if (h.education === undefined) h.education = { scholarship: 5, martial: 5, virtue: 5 };
    }
    return { ...env, formatVersion: 3, state, checksum: checksumOf(state) };
  },
  3: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    if (state.taihou === undefined) state.taihou = { ill: false };
    return { ...env, formatVersion: 4, state, checksum: checksumOf(state) };
  },
  // v4 → v5: 属性系统重构。court 支柱拆为 sovereign+nation；皇嗣补明面/暗属性默认值。
  4: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const resources = (state.resources ?? {}) as Record<string, unknown>;
    const court = resources.court as Record<string, number> | undefined;
    if (court !== undefined) {
      if (resources.sovereign === undefined) {
        resources.sovereign = {
          health: 70,
          diligence: 50,
          prestige: court.authority ?? 50,
          martial: 50,
          statecraft: 50,
          cruelty: 20,
          fatigue: 20,
          regimeSecurity: 60,
        };
      }
      if (resources.nation === undefined) {
        resources.nation = {
          military: 50,
          treasury: 10000,
          publicSupport: court.publicSupport ?? 50,
          productivity: 50,
          governance: 50,
          consortClanPower: 30,
          ministerLoyalty: 50,
          corruption: 20,
          clanDiscontent: court.factionPressure ?? 20,
          rumor: 10,
        };
      }
      delete resources.court;
    }
    if (resources.storehouse === undefined) {
      resources.storehouse = { items: {} };
    }
    const bloodline = ((resources.bloodline ?? {}) as Record<string, unknown>);
    const heirs = (bloodline.heirs as Record<string, unknown>[] | undefined) ?? [];
    for (const h of heirs) {
      if (h.health === undefined) h.health = 60;
      if (h.talent === undefined) h.talent = 50;
      if (h.diligence === undefined) h.diligence = 50;
      if (h.ambition === undefined) h.ambition = 20;
      if (h.closeness === undefined) h.closeness = 50;
      if (h.support === undefined) h.support = 20;
      if (h.faction === undefined) h.faction = "none";
    }
    return { ...env, formatVersion: 5, state, checksum: checksumOf(state) };
  },
  // v5 → v6、v6 → v7 迁移均按 no-save-backcompat 政策省略。
  // 旧档命中缺失的 MIGRATIONS[v] 即 quarantine（pre-release，不保旧档）。

  // 官员家族系统（officialFamilies/familyMembers/kinship + Official 形状扩展 + standing.birthFamilyId）
  // 随 v9 schema 引入：按 no-save-backcompat 政策（pre-release）**不写官员世界 backfill**——旧档前向
  // 迁移到 v10 后仍缺这些字段，由 gameStateSchema 拒绝并 quarantine，绝不在加载旧档时重随机官员世界。
  // 新档以当前 schema round-trip 稳定。

  // v7 → v8: 引入 eventReactionLog 字段（T10）。旧档若缺失此字段补空数组。
  7: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!Array.isArray(state.eventReactionLog)) {
      state.eventReactionLog = [];
    }
    return {
      ...env,
      formatVersion: 8,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v8 → v9: 引入 statusEffects（禁足等持续状态）。旧档补空数组；清除遗留的 standing.confined
  // 占位布尔（已由 statusEffects 取代，strictObject 会拒绝未知键）。
  8: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!Array.isArray(state.statusEffects)) {
      state.statusEffects = [];
    }
    const standing = state.standing as unknown as Record<string, Record<string, unknown>> | undefined;
    if (standing) {
      for (const st of Object.values(standing)) {
        if (st && typeof st === "object" && "confined" in st) delete st.confined;
      }
    }
    return {
      ...env,
      formatVersion: 9,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v9 → v10: 引入 haremAdministration 字段（六宫主理权）。旧档默认 { mode: "empress" }。
  9: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!state.haremAdministration) {
      state.haremAdministration = { mode: "empress" };
    }
    return {
      ...env,
      formatVersion: 10,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v10 → v11: 官员生命周期（pendingRetirements / officialHistory + Official 状态原因/时刻
  // 可选字段）。旧档补空数组即可（官员既有字段形状不变；新增 official 字段均 optional）。
  // 同时引入侍君 fear/ambition/loyalty/haremFactionId——均 optional，resolver 提供回退，
  // 无需物化，可搭官员迁移一同完成。
  10: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!Array.isArray(state.pendingRetirements)) state.pendingRetirements = [];
    if (!Array.isArray(state.officialHistory)) state.officialHistory = [];
    return {
      ...env,
      formatVersion: 11,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v11 → v12: 科举候补官员池 + justice 持久记录层。旧档补空即可。
  11: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (typeof state.officialCandidates !== "object" || state.officialCandidates === null) state.officialCandidates = {};
    if (!Array.isArray(state.examinationResults)) state.examinationResults = [];
    if (!state.justice) {
      state.justice = {
        cases: {},
        punishments: {},
        nextSeq: { case: 1, punishment: 1, charge: 1, evidence: 1, confession: 1, verdict: 1 },
      };
    }
    return {
      ...env,
      formatVersion: 12,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v12 → v13: officialHistory 增可选 appointment 溯源；如旧档无 justice 层则补空。
  12: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!state.justice) {
      state.justice = {
        cases: {},
        punishments: {},
        nextSeq: { case: 1, punishment: 1, charge: 1, evidence: 1, confession: 1, verdict: 1 },
      };
    }
    return {
      ...env,
      formatVersion: 13,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v13 → v14: 官员增静态能力 aptitude + 动态履历 reviewState（PR3C-1）。回填优先级：已有值 →
  // 候补出身者继承其候补能力（v13 已有 PR3B 授官记录，须保持同一人能力一致）→ 否则稳定 seed 确定性
  // 派生。reviewState 取初值。物化入档，读档不重算。
  13: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    const rngSeed = state.rngSeed;
    // appointedOfficialId → 候补能力（仅取已转正、回指一致的候补）。
    const inheritedAptitude = new Map<string, OfficialAptitude>();
    for (const c of Object.values(state.officialCandidates ?? {})) {
      if (c.status === "appointed" && c.appointedOfficialId) inheritedAptitude.set(c.appointedOfficialId, c.aptitude);
    }
    const officials: Record<string, Official> = {};
    for (const [id, o] of Object.entries(state.officials)) {
      const off = o as Official & Partial<Pick<Official, "aptitude" | "reviewState">>;
      officials[id] = {
        ...off,
        aptitude: off.aptitude ?? inheritedAptitude.get(id) ?? deriveOfficialAptitude(id, rngSeed),
        reviewState: off.reviewState ?? initialReviewState(),
      };
    }
    const next = { ...state, officials };
    return {
      ...env,
      formatVersion: 14,
      state: next,
      checksum: checksumOf(next),
    };
  },
  // v14 → v15: 年度吏部考课人事简报（annualReviews）。旧档补空数组即可。
  14: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    if (!Array.isArray(state.annualReviews)) state.annualReviews = [];
    return {
      ...env,
      formatVersion: 15,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v15 → v16: canonical apMax changed from 6 to 5 (PR7A).  Clamp any saved
  // ap/apMax so existing saves run at the correct action-point budget.
  15: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    const cal = state.calendar;
    if (cal.apMax === 6) {
      (state as { calendar: typeof cal }).calendar = {
        ...cal,
        apMax: 5,
        ap: Math.min(cal.ap, 5),
      };
    }
    return { ...env, formatVersion: 16, state, checksum: checksumOf(state) };
  },
  // v18 → v19: 冷宫事件通报队列（PUNISH-4C）。旧档无此字段，补空数组。
  18: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    if (!Array.isArray(state.coldPalaceIncidents)) {
      state.coldPalaceIncidents = [];
    }
    const gs = state as unknown as GameState;
    return { ...env, formatVersion: 19, state: gs, checksum: checksumOf(gs) };
  },
  // v16 → v17: PunishmentRecord domain-neutral 化（PR3C-3a）。旧档记录全部为侍君目标，补 targetKind="consort"。
  16: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    const puns = (state as unknown as { justice?: { punishments?: Record<string, Record<string, unknown>> } }).justice?.punishments;
    if (puns) for (const rec of Object.values(puns)) if (rec.targetKind === undefined) rec.targetKind = "consort";
    return {
      ...env,
      formatVersion: 17,
      state: state as GameState,
      checksum: checksumOf(state as GameState),
    };
  },
  // v17 → v18: 人事决策集合（PR3C-3b）。旧档无任何待裁决策，补空记录。
  17: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    if ((state as unknown as { personnelDecisions?: unknown }).personnelDecisions === undefined) {
      (state as unknown as { personnelDecisions: Record<string, never> }).personnelDecisions = {};
    }
    return { ...env, formatVersion: 18, state, checksum: checksumOf(state) };
  },
  // v19 → v20: 奏折框架（Phase 4A）。旧档无任何奏折，补空记录。
  19: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    if ((state as unknown as { memorials?: unknown }).memorials === undefined) {
      (state as unknown as { memorials: Record<string, never> }).memorials = {};
    }
    return { ...env, formatVersion: 20, state, checksum: checksumOf(state) };
  },
  // v20 → v21: 冷宫严重病情（PUNISH-4D）。ColdPalaceIncident 扩展为 discriminated union；
  // 旧档中 petition / health_deterioration 记录无新字段，schema 直接通过（严格对象）。
  // critical_illness 类型为新增，旧档无此 kind，无需数据变换；仅升版本号。
  20: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    return { ...env, formatVersion: 21, checksum: checksumOf(env.state) };
  },
  // v21 → v22: 长门宫探视（PUNISH-4E）。新增 coldPalaceInterventions 字段；
  // 旧档无此字段，schema.default([]) 负责填充，此处仅升版本号。
  21: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    return { ...env, formatVersion: 22, checksum: checksumOf(env.state) };
  },
  // v22 → v23: 财政奏折框架（Phase 4B）。旧档回填 treasuryLedger；pending disaster 奏折补 treasuryDelta；
  // resolved 不补（不伪造历史账目）。已有 treasuryDelta 不覆盖。
  22: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;

    // 回填 treasuryLedger（Zod schema .default([]) 已兜底，但迁移显式保证）
    if (!Array.isArray((state as unknown as { treasuryLedger?: unknown }).treasuryLedger)) {
      (state as unknown as { treasuryLedger: TreasuryLedgerEntry[] }).treasuryLedger = [];
    }

    // PENDING disaster 奏折选项补 treasuryDelta；resolved 及 treasury 类别奏折不处理
    const memorials = (
      state as unknown as { memorials?: Record<string, Record<string, unknown>> }
    ).memorials ?? {};
    for (const m of Object.values(memorials)) {
      if (m.status !== "pending") continue;
      const payload = m.payload as Record<string, unknown> | undefined;
      if (!payload || payload.category !== "disaster") continue;
      const severity = payload.severity as string | undefined;
      const options = (payload.options as Record<string, unknown>[] | undefined) ?? [];
      for (const opt of options) {
        if (opt.treasuryDelta !== undefined) continue; // 不覆盖已有值
        if (opt.id === "relief") {
          opt.treasuryDelta = severity === "major" ? -900 : -400;
        } else if (opt.id === "tax_remit") {
          opt.treasuryDelta = severity === "major" ? -600 : -250;
        }
        // ignore: 不补
      }
    }

    const gs = state as unknown as GameState;
    return { ...env, formatVersion: 23, state: gs, checksum: checksumOf(gs) };
  },
  // v23 → v24: PUNISH-4F 冷宫精神失常。旧档无 ColdPalaceMadnessEffect，Zod schema .default([]) 兜底。
  23: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    // statusEffects already handled by Zod defaults; nothing to migrate structurally.
    return { ...env, formatVersion: 24, state: state as unknown as GameState, checksum: checksumOf(state) };
  },
  // v24 → v25: 边患压力 + 年度边情评估（Phase 4C）。
  // 旧档回填 borderPressure 默认值 35；frontierAssessments 初始化为空数组。
  24: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;

    const nation = (state as unknown as { resources: { nation: Record<string, unknown> } }).resources.nation;
    if (nation.borderPressure === undefined || nation.borderPressure === null) {
      nation.borderPressure = 35;
    }

    if (!Array.isArray((state as unknown as { frontierAssessments?: unknown }).frontierAssessments)) {
      (state as unknown as { frontierAssessments: FrontierAssessment[] }).frontierAssessments = [];
    }

    const gs = state as unknown as GameState;
    return { ...env, formatVersion: 25, state: gs, checksum: checksumOf(gs) };
  },
  // v25 → v26: 社交模拟层（Phase 4B-social）。
  // personality / household 新增至 CharacterStanding。
  // 侍君识别依据 GameState.bedchamber（含义：每名侍君恰有一条 bedchamber 记录，非侍君无）。
  // 不用 affection/fear/ambition 识别，因为 hidden 为 optional，旧版 consortStandingExtras
  // 在 hidden 缺失时不写入这些字段，导致合法侍君被漏掉。
  // defaults 内联以保证迁移值不随以后常量修改而变动。
  25: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    const standing = (state as unknown as { standing?: Record<string, Record<string, unknown>> }).standing;
    const bedchamber = (state as unknown as { bedchamber?: Record<string, unknown> }).bedchamber;
    const consortIds = new Set(Object.keys(bedchamber ?? {}));
    if (standing) {
      for (const [charId, entry] of Object.entries(standing)) {
        if (!consortIds.has(charId)) continue;
        if (!entry || typeof entry !== "object") continue;
        if (!entry.personality) {
          entry.personality = {
            intelligence: 50, scheming: 25, sociability: 50, compassion: 50,
            courage: 40, jealousy: 35, emotionalStability: 55, pride: 45,
          };
        }
        if (!entry.household) {
          entry.household = { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 20 };
        }
      }
    }
    return { ...env, formatVersion: 26, state: state as GameState, checksum: checksumOf(state as GameState) };
  },
  // v26 → v27: 称谓系统权威化（PR #68）。后宫位分 ID 全量重映射：
  //   fenghou → huanghou, huangguijun → huangguifu, guijun → guifu,
  //   jun → fu, guifu(旧正二品贵驸) → zhaoyi, zhaorong → zhaode
  // 覆盖所有存储旧 rankId 的位置：standing.rank、deathRecord、
  // generatedConsorts.initialStanding.rank、chronicle rank_changed payload
  // （支持 from/to 和 fromRankId/toRankId 两种字段名）、justice rank_demotion details。
  26: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState;
    const RANK_REMAP: Record<string, string> = {
      fenghou: "huanghou",
      huangguijun: "huangguifu",
      guijun: "guifu",
      jun: "fu",
      guifu: "zhaoyi",
      zhaorong: "zhaode",
    };
    const remap = (id: string): string => RANK_REMAP[id] ?? id;

    // standing.rank + deathRecord rank fields
    for (const standing of Object.values(state.standing)) {
      standing.rank = remap(standing.rank);
      if (standing.deathRecord) {
        standing.deathRecord.originalRankId = remap(standing.deathRecord.originalRankId);
        if (standing.deathRecord.posthumousRankId !== undefined) {
          standing.deathRecord.posthumousRankId = remap(standing.deathRecord.posthumousRankId);
        }
      }
    }

    // generatedConsorts.initialStanding.rank
    for (const consort of Object.values(state.generatedConsorts)) {
      const initSt = (consort as { initialStanding?: { rank?: string } }).initialStanding;
      if (initSt?.rank !== undefined) initSt.rank = remap(initSt.rank);
    }

    // chronicle rank_changed payload — two field variants:
    // haremAdminCommands writes fromRankId/toRankId;
    // chronicle rules validator uses from/to.
    for (const entry of state.chronicle) {
      if (entry.type === "rank_changed") {
        const p = entry.payload as Record<string, unknown>;
        if (typeof p.from === "string") p.from = remap(p.from);
        if (typeof p.to === "string") p.to = remap(p.to);
        if (typeof p.fromRankId === "string") p.fromRankId = remap(p.fromRankId);
        if (typeof p.toRankId === "string") p.toRankId = remap(p.toRankId);
      }
    }

    // justice punishment rank_demotion details.fromRankId / toRankId
    const jPunishments = (state as unknown as {
      justice?: { punishments?: Record<string, { kind?: string; details?: Record<string, string> }> }
    }).justice?.punishments;
    if (jPunishments) {
      for (const pun of Object.values(jPunishments)) {
        if (pun.kind === "rank_demotion" && pun.details) {
          if (typeof pun.details.fromRankId === "string") pun.details.fromRankId = remap(pun.details.fromRankId);
          if (typeof pun.details.toRankId === "string") pun.details.toRankId = remap(pun.details.toRankId);
        }
      }
    }

    return { ...env, formatVersion: 27, state, checksum: checksumOf(state) };
  },
  // v27 → v28: Add peakFavor to CharacterStanding. Initialize to current favor.
  27: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as GameState & Record<string, unknown>;
    const standing = (state as unknown as { standing?: Record<string, unknown> }).standing;
    if (standing && typeof standing === "object") {
      for (const st of Object.values(standing)) {
        if (st && typeof st === "object" && typeof (st as Record<string, unknown>).favor === "number") {
          const s = st as Record<string, unknown>;
          if (typeof s.peakFavor !== "number") {
            s.peakFavor = s.favor;
          }
        }
      }
    }
    const gs = state as unknown as GameState;
    return { ...env, formatVersion: 28, state: gs, checksum: checksumOf(gs) };
  },
  // v28 → v29: 六宫年度例核（PR #76）。新增 haremAdminReviews 字段；
  // 旧档无此字段，schema.default([]) 负责填充，此处仅升版本号。
  28: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    return { ...env, formatVersion: 29, checksum: checksumOf(env.state) };
  },
  // v29 → v30: 后宫内部惩戒（PUNISH-4G-B）。新增 haremDisciplineIncidents 字段；
  // 旧档无此字段，schema.default([]) 负责填充，此处仅升版本号。
  29: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    return { ...env, formatVersion: 30, checksum: checksumOf(env.state) };
  },
};

export interface SaveSystemOptions {
  logger?: RingBufferLogger;
  now?: () => number;
}

export interface SaveData extends SaveEnvelope {
  state: GameState;
}

export interface LoadedSave {
  state: GameState;
  warnings: GameError[];
  /** Envelope summary for previews (e.g. the import flow before it writes a slot). */
  meta: { createdAt: string; contentVersion: string; slot: string };
}

const keyOf = (slot: SaveSlot): string => `${SAVE_KEY_PREFIX}${slot}`;

export function hashContent(db: ContentDB): string {
  return fnv1a64Hex(canonicalStringify(db));
}

export function createSaveData(
  db: ContentDB,
  state: GameState,
  slot: string,
  options: SaveSystemOptions = {},
): SaveData {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: db.contentVersion,
    contentHash: hashContent(db),
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    slot,
    checksum: checksumOf(state),
    state,
  };
}

export function writeSave(
  storage: KVStorage,
  db: ContentDB,
  state: GameState,
  slot: SaveSlot,
  options: SaveSystemOptions = {},
): Result<{ key: string; bytes: number }, GameError> {
  const payload = JSON.stringify(createSaveData(db, state, slot, options));
  try {
    storage.set(keyOf(slot), payload);
  } catch (cause) {
    const error = saveError("STORAGE", `cannot write save "${slot}" (quota/unavailable)`, {
      context: { slot },
      cause,
    });
    options.logger?.logGameError(error);
    return err(error);
  }
  // Save size is logged from day one — the localStorage ceiling is ~5 MB.
  options.logger?.info(`save written: ${slot}`, { bytes: payload.length });
  return ok({ key: keyOf(slot), bytes: payload.length });
}

/** Rotate auto → auto.prev, then write the new auto (corruption safety net). */
export function autosave(
  storage: KVStorage,
  db: ContentDB,
  state: GameState,
  options: SaveSystemOptions = {},
): Result<{ key: string; bytes: number }, GameError> {
  const previous = storage.get(keyOf("auto"));
  if (previous !== null) {
    try {
      storage.set(keyOf("auto.prev"), previous);
    } catch {
      // rotation is best-effort; the fresh autosave below still reports failures
    }
  }
  return writeSave(storage, db, state, "auto", options);
}

function quarantine(
  storage: KVStorage,
  slot: SaveSlot,
  raw: string,
  options: SaveSystemOptions,
): string {
  const corruptKey = `${CORRUPT_KEY_PREFIX}${(options.now ?? Date.now)()}`;
  try {
    storage.set(corruptKey, raw);
    storage.remove(keyOf(slot)); // preserved under the corrupt key — never destroyed
  } catch {
    // if even quarantine fails, leave the original in place
  }
  return corruptKey;
}

/** Validate a parsed save against content — shared by slot reads and imports. */
function validateSave(
  db: ContentDB,
  data: unknown,
): Result<LoadedSave, { error: GameError; quarantineWorthy: boolean }> {
  const envelope = saveEnvelopeSchema.safeParse(data);
  if (!envelope.success) {
    return err({
      error: saveError("CORRUPT", "save envelope is malformed"),
      quarantineWorthy: true,
    });
  }
  let save = envelope.data;

  if (save.formatVersion > SAVE_FORMAT_VERSION) {
    // A future version is not corruption — refuse, never destroy.
    return err({
      error: saveError("FUTURE_VERSION", `save format v${save.formatVersion} is newer than v${SAVE_FORMAT_VERSION}`),
      quarantineWorthy: false,
    });
  }
  // All pre-v12 saves are rejected (not quarantined as corrupt).
  // v9+ has active statusEffects/haremAdministration state without corresponding JusticeRecords;
  // migrating them to empty justice leaves half-migrated state worse than rejection.
  // v7/v8 saves also lack v9+ fields, so we reject all pre-v12 uniformly.
  if (save.formatVersion < 12) {
    return err({
      error: saveError("OBSOLETE_VERSION", `save format v${save.formatVersion} is no longer supported (current: v${SAVE_FORMAT_VERSION}). Start a new game.`),
      quarantineWorthy: false,
    });
  }
  for (let v = save.formatVersion; v < SAVE_FORMAT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      return err({
        error: saveError("CORRUPT", `no migration from save format v${v}`),
        quarantineWorthy: true,
      });
    }
    const migrated = saveEnvelopeSchema.safeParse(migrate(save));
    if (!migrated.success) {
      return err({
        error: saveError("CORRUPT", `migration from v${v} produced an invalid save`),
        quarantineWorthy: true,
      });
    }
    save = migrated.data;
  }

  if (checksumOf(save.state) !== save.checksum) {
    return err({
      error: saveError("CORRUPT", "checksum mismatch — save content was altered or truncated"),
      quarantineWorthy: true,
    });
  }

  const parsedState = gameStateSchema.safeParse(save.state);
  if (!parsedState.success) {
    return err({
      error: saveError("CORRUPT", `saved state fails validation: ${parsedState.error.issues[0]?.message ?? ""}`),
      quarantineWorthy: true,
    });
  }
  const state = parsedState.data;

  // Content-id cross-check: a save may only load against content that still
  // knows every id it references.
  const missing: string[] = [];
  if (state.playerLocation !== "" && !db.locations[state.playerLocation]) {
    missing.push(`location:${state.playerLocation}`);
  }
  for (const charId of [
    ...Object.keys(state.standing),
    ...Object.keys(state.memories),
  ]) {
    // 动态侍君（殿选落库）存于 generatedConsorts，不在 db.characters——两处都查方为缺失。
    if (!db.characters[charId] && !state.generatedConsorts[charId]) missing.push(`character:${charId}`);
  }
  for (const entry of state.eventLog) {
    if (!db.events[entry.eventId]) missing.push(`event:${entry.eventId}`);
  }
  for (const sceneId of state.sceneHistory) {
    if (!db.scenes[sceneId]) missing.push(`scene:${sceneId}`);
  }
  // Severe tier: the save points at content objects that no longer exist.
  // It cannot load coherently → quarantine, never silently load (plan §9).
  if (missing.length > 0) {
    const refs = [...new Set(missing)];
    return err({
      error: saveError("MISSING_REF", `存档引用了当前内容不存在的对象（${refs.join("、")}），已隔离`, {
        context: { missing: refs },
      }),
      quarantineWorthy: true,
    });
  }

  // Official-world cross-collection invariants (官员/家族/亲缘)。Zod 只校验形状；跨集合不变量
  // 由 world validator 负责。任一 error 级诊断 → 拒绝并 quarantine（绝不静默载入损坏官员图）。
  const worldErrors = validateOfficialWorld(state, db);
  if (worldErrors.length > 0) {
    const first = worldErrors[0]!;
    return err({
      error: saveError("OFFICIAL_INTEGRITY", `存档官员数据完整性校验失败（${first.code}）：${first.message}`, {
        context: { diagnostics: worldErrors.map((e) => ({ code: e.code, message: e.message })) },
      }),
      quarantineWorthy: true,
    });
  }

  // 奏折集合不变量（Phase 4A）：key/去重/类别一致/状态-裁断一致/disaster 载荷。任一 error → 拒绝并 quarantine。
  const memorialErrors = validateMemorials(state);
  if (memorialErrors.length > 0) {
    const first = memorialErrors[0]!;
    return err({
      error: saveError("MEMORIAL_INTEGRITY", `存档奏折数据完整性校验失败（${first.code}）：${first.message}`, {
        context: { diagnostics: memorialErrors.map((e) => ({ code: e.code, message: e.message })) },
      }),
      quarantineWorthy: true,
    });
  }

  // 国库台账不变量（Phase 4B）：链接一致性/来源合法/余额链路。任一 error → 拒绝并 quarantine。
  const ledgerErrors = validateTreasuryLedger(state);
  if (ledgerErrors.length > 0) {
    const first = ledgerErrors[0]!;
    return err({
      error: saveError("TREASURY_LEDGER_INTEGRITY", `存档国库台账完整性校验失败（${first.code}）：${first.message}`, {
        context: { diagnostics: ledgerErrors.map((e) => ({ code: e.code, message: e.message })) },
      }),
      quarantineWorthy: true,
    });
  }

  // 边情评估不变量（Phase 4C）：ID/唯一性/排序/压力方程/烈度一致/奏折交叉引用。任一 error → 拒绝并 quarantine。
  const frontierErrors = validateFrontierAssessments(state);
  if (frontierErrors.length > 0) {
    const first = frontierErrors[0]!;
    return err({
      error: saveError("FRONTIER_INTEGRITY", `存档边情评估完整性校验失败（${first.code}）：${first.message}`, {
        context: { diagnostics: frontierErrors.map((e) => ({ code: e.code, message: e.message })) },
      }),
      quarantineWorthy: true,
    });
  }

  // Warn tier: every referenced id still resolves, but the content changed
  // since the save. Loadable, but values may read oddly → visible warning,
  // never silent (plan §9). This is NOT the severe tier above.
  const warnings: GameError[] = [];
  if (save.contentHash !== hashContent(db) || save.contentVersion !== db.contentVersion) {
    warnings.push(
      saveError(
        "CONTENT_MISMATCH",
        `存档内容版本（${save.contentVersion}）与当前（${db.contentVersion}）不一致：可载入，但部分内容可能与存档时不同`,
        {
          severity: "warn",
          context: { saved: save.contentVersion, current: db.contentVersion },
        },
      ),
    );
  }
  return ok({
    state,
    warnings,
    meta: { createdAt: save.createdAt, contentVersion: save.contentVersion, slot: save.slot },
  });
}

export function readSlot(
  storage: KVStorage,
  db: ContentDB,
  slot: SaveSlot,
  options: SaveSystemOptions = {},
): Result<LoadedSave, GameError> {
  const raw = storage.get(keyOf(slot));
  if (raw === null) {
    return err(saveError("NOT_FOUND", `no save in slot "${slot}"`, { severity: "warn" }));
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const key = quarantine(storage, slot, raw, options);
    const error = saveError("CORRUPT", `slot "${slot}" is not valid JSON; quarantined to ${key}`, {
      context: { slot, quarantineKey: key },
    });
    options.logger?.logGameError(error);
    return err(error);
  }

  const validated = validateSave(db, data);
  if (!validated.ok) {
    if (validated.error.quarantineWorthy) {
      const key = quarantine(storage, slot, raw, options);
      const error = saveError(validated.error.error.code, `slot "${slot}": ${validated.error.error.message}; quarantined to ${key}`, {
        context: { ...validated.error.error.context, slot, quarantineKey: key },
      });
      options.logger?.logGameError(error);
      return err(error);
    }
    options.logger?.logGameError(validated.error.error);
    return err(validated.error.error);
  }
  for (const warning of validated.value.warnings) options.logger?.logGameError(warning);
  return ok(validated.value);
}

export interface RecoveredSave extends LoadedSave {
  usedSlot: SaveSlot;
}

/** auto → auto.prev recovery ladder (UI offers older slots / new game after). */
export function loadWithRecovery(
  storage: KVStorage,
  db: ContentDB,
  options: SaveSystemOptions = {},
): Result<RecoveredSave, GameError[]> {
  const errors: GameError[] = [];
  for (const slot of ["auto", "auto.prev"] as const) {
    const result = readSlot(storage, db, slot, options);
    if (result.ok) {
      if (slot === "auto.prev") {
        const warning = saveError("RECOVERED", "自动存档已损坏，已从上一份自动存档恢复", {
          severity: "warn",
        });
        options.logger?.logGameError(warning);
        return ok({ ...result.value, warnings: [...result.value.warnings, warning], usedSlot: slot });
      }
      return ok({ ...result.value, usedSlot: slot });
    }
    errors.push(result.error);
  }
  return err(errors);
}

export interface SlotInfo {
  slot: SaveSlot;
  status: "empty" | "ok" | "corrupt";
  createdAt?: string;
  /** 终局存档（先帝已崩）：菜单据此禁用「继续」。浅读，不做 schema 校验。 */
  gameOver?: boolean;
}

/** Shallow listing for the save menu — never quarantines, never throws. */
export function listSaves(storage: KVStorage): SlotInfo[] {
  return ALL_SLOTS.map((slot) => {
    const raw = storage.get(keyOf(slot));
    if (raw === null) return { slot, status: "empty" as const };
    try {
      const data = JSON.parse(raw) as { createdAt?: unknown; state?: { gameOver?: unknown } };
      return {
        slot,
        status: "ok" as const,
        ...(typeof data.createdAt === "string" ? { createdAt: data.createdAt } : {}),
        ...(data.state?.gameOver != null ? { gameOver: true } : {}),
      };
    } catch {
      return { slot, status: "corrupt" as const };
    }
  });
}

/** Export the LIVE state as a save file payload (debug + user backup). */
export function exportSaveText(db: ContentDB, state: GameState, options: SaveSystemOptions = {}): string {
  return JSON.stringify(createSaveData(db, state, "export", options), null, 2);
}

/** Import runs the exact same ladder as slot reads (minus quarantine). */
export function importSaveText(db: ContentDB, text: string): Result<LoadedSave, GameError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err(saveError("CORRUPT", "导入的文件不是有效的存档 JSON"));
  }
  const validated = validateSave(db, data);
  if (!validated.ok) return err(validated.error.error);
  return ok(validated.value);
}
