/**
 * GameState shape (skeleton-plan §4). Plain TS types in PR 2; PR 3 introduces
 * the Zod schemas as the runtime-validation source and these types align with
 * z.infer there. Resource pillars are scaffold-only (§2 guard): initialized,
 * mutated by effects, shown in debug, persisted — never read by logic.
 */
import type { CalendarState, GameTime } from "../calendar/time";
import type { CharacterContent } from "../content/schemas";
import type { JusticeState, JusticeLinks } from "../justice/types";
import type { HaremIntriguePlan, HaremIntrigueOutcome, HaremIntrigueKind } from "../characters/haremIntrigue/types";

// ── Global resource pillars (scaffold values 0–100) ──────────────────
// 皇帝(玩家本人)属性。明面: health/diligence/prestige/martial/statecraft；
// 暗属性: cruelty/fatigue/regimeSecurity。年龄/生日在 calendar，非此处。见
// docs/systems/21-attribute-catalog.md。
export interface SovereignState {
  /** 健康 */
  health: number;
  /** 病情状态（与 health 数值独立）。 */
  healthStatus: HealthStatus;
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
  /** 勤政 */
  diligence: number;
  /** 威望（原 court.authority 圣威） */
  prestige: number;
  /** 武力 */
  martial: number;
  /** 政略 */
  statecraft: number;
  /** 暴戾（暗） */
  cruelty: number;
  /** 疲劳（暗） */
  fatigue: number;
  /** 皇权安全（暗） */
  regimeSecurity: number;
}

// 国家属性。明面: military/treasury/publicSupport/productivity/governance/
// consortClanPower；暗属性: ministerLoyalty/corruption/clanDiscontent/rumor。
export interface NationState {
  /** 军力 */
  military: number;
  /** 国库（铜钱，单位：两） */
  treasury: number;
  /** 民心 */
  publicSupport: number;
  /** 生产力 */
  productivity: number;
  /** 朝政（官僚效率，原“大臣能力”） */
  governance: number;
  /** 外戚权势 */
  consortClanPower: number;
  /** 大臣忠心（暗） */
  ministerLoyalty: number;
  /** 贪腐（暗） */
  corruption: number;
  /** 宗室不满（暗） */
  clanDiscontent: number;
  /** 谣言热度（暗） */
  rumor: number;
  /** 边患压力（暗属性，0–100）。0=边境安宁；100=烽烟四起。年度边情评估更新。 */
  borderPressure: number;
}

export type MenstrualStatus = "normal" | "irregular" | "absent";

export type PregnancyStatus = "none" | "pending" | "carrying";

/** 病情状态（与数值 health 独立存储）。 */
export type HealthStatus = "healthy" | "sick" | "critical";

/** 死因（写入 deathRecord / decease 效果）。 */
export type DeathCause =
  | "illness"
  | "critical_sudden"
  | "pregnancy"
  | "childbirth"
  | "scripted"
  | "imperial_execution";

export interface PregnancyState {
  /** none=未孕/已传嗣后(健康); pending=已受孕未告知; carrying=帝王自孕中 */
  status: PregnancyStatus;
  conceivedAt?: GameTime;
  /** 候选承嗣 charIds（孕二月敬事房打标签；可为空） */
  candidateIds: string[];
}

/** 当前唯一在孕的胎息（单线孕育）。 */
export interface GestationState {
  /** "sovereign"=帝王自孕；否则承载侍君 charId */
  carrier: "sovereign" | string;
  conceivedAt: GameTime;
  /** 承嗣君 charId；自孕则不设 */
  fatherId?: string;
  /** 传嗣时的孕月（驱动难产几率）；自孕则不设 */
  transferredAtMonth?: number;
}

export type HeirSex = "daughter" | "son";

export type HeirLifecycle = "alive" | "deceased";

/**
 * 皇嗣党羽倾向（暗属性，文本枚举而非数值）。见 21-attribute-catalog.md。
 * none=无明显党羽 / empress=亲近皇后 / adoptive=依附承养人 / maternal=受母家扶持 /
 * scholars=得清流称许 / generals=得武将拥护 / clan=与宗室往来 / wavering=朝臣观望 /
 * foreign=暗结外臣。
 */
export type HeirFaction =
  | "none"
  | "empress"
  | "adoptive"
  | "maternal"
  | "scholars"
  | "generals"
  | "clan"
  | "wavering"
  | "foreign";

/** 皇嗣养成属性（上书房问功课提升）。政治=学问，复用 scholarship，不另设字段。 */
export interface HeirEducation {
  /** 学问（含政治/治术）0–100 */
  scholarship: number;
  /** 骑射/武力 0–100 */
  martial: number;
  /** 品行/道德 0–100 */
  virtue: number;
}

/** 落地子嗣。 */
export interface Heir {
  /** "heir_000001" 单调 */
  id: string;
  sex: HeirSex; // daughter→皇子(女) / son→皇郎(男)
  /** 承嗣君 charId；null=自孕 */
  fatherId: string | null;
  /** 谁承载生产；"sovereign"=自孕 */
  bearer: "sovereign" | string;
  birthAt: GameTime;
  /** 宠爱度 0–100 */
  favor: number;
  /** 嫡 */
  legitimate: boolean;
  /** 小名（≤2 字），出生时设；未起为 ""。 */
  petName: string;
  /** 正名/姓名（≤2 字），百日宴设；未命名为 undefined。 */
  givenName?: string;
  /** 养成属性。 */
  education: HeirEducation;
  /** 养父 charId；未指定为 undefined。 */
  adoptiveFatherId?: string;
  // ── 明面养成元参数 ──
  /** 健康 0–100（夭折/生病）。 */
  health: number;
  /** 天赋 0–100（学习上限）。 */
  talent: number;
  /** 努力 0–100（成长速度）。 */
  diligence: number;
  // ── 暗属性 ──
  /** 野心 0–100（是否主动争储）。 */
  ambition: number;
  /** 对皇帝亲近 0–100。 */
  closeness: number;
  /** 继位支持度 0–100。 */
  support: number;
  /** 党羽倾向（文本枚举）。 */
  faction: HeirFaction;
  /** 生死状态（出生置 alive；heir_died 转 deceased）。 */
  lifecycle: HeirLifecycle;
  /** 夭折时刻；存活时 undefined。 */
  deceasedAt?: GameTime;
  /** 病情状态（出生置 healthy；旧存档可能无此字段）。 */
  healthStatus?: HealthStatus;
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
}

export interface BloodlineState {
  /** 经血状态 */
  menstrualStatus: MenstrualStatus;
  /** 经血祭仪 scaffold */
  lastRiteAt?: GameTime;
  /** 帝王孕育状态（帝王自身的身体：是否自孕） */
  pregnancy: PregnancyState;
  /**
   * 当前在孕的所有胎息（多线孕育）：至多一个 carrier="sovereign"（帝王自孕），
   * 其余为承嗣侍君各自承载的一胎。传嗣后帝王 pregnancy 归 none，可再次自孕，
   * 故同一时刻帝王自孕与多名侍君承嗣可并存。
   */
  gestations: GestationState[];
  /** 已落地子嗣。 */
  heirs: Heir[];
}

/** 库房（私库）：铜钱在 nation.treasury，本处只存物品库存。 */
export interface StorehouseState {
  /** itemId → 数量；为 0 即删除该 key。 */
  items: Record<string, number>;
}

export interface Resources {
  sovereign: SovereignState;
  nation: NationState;
  bloodline: BloodlineState;
  storehouse: StorehouseState;
}

// ── Per-character runtime state ───────────────────────────────────────

/** 官员生命周期状态。非 active 状态下 postId 必为 null（席位释放，校验器强制）。 */
export type OfficialStatus = "active" | "retired" | "imprisoned" | "exiled" | "dead";

/** 状态变化原因（受控枚举；具体罪名留待后续放事件/判决记录）。 */
export type OfficialStatusReason =
  | "retirement"
  | "dismissal"
  | "imprisonment"
  | "exile"
  | "natural_death"
  | "execution";

/**
 * 朝臣名册条目（轻量运行态）。权势不落字段——由 postId→品级 派生（见 officials/power）。
 * 官员只能是女性（世界观硬约束），故无 sex 字段。postId 可空：官职是稳定席位，
 * 官员去职/获罪后席位空缺而官职仍在，故 postId 允许 null。familyId 必有（官员必属一族）。
 * 死亡不删除人物：dead 仍是侍君生母/家族成员/历史人物，只是不能再任职、不再被任免源选中。
 */
export interface Official {
  id: string;
  surname: string;
  givenName: string;
  /** 占据的官职；null = 无职/空缺（去职后官职仍存于 content，仅席位释放）。 */
  postId: string | null;
  loyalty: number; // 忠心 0–100（官员个人，与家族属性分离）
  age: number; // 入仕年龄约束见 officials/constraints
  familyId: string; // 所属官员家族（母系实体）
  status: OfficialStatus;
  /** 静态四维能力（与候补同构）。授官原样继承；开局/现有官员确定性回填，读档不重生成。 */
  aptitude: OfficialAptitude;
  /** 动态履历（年度考课累积；PR3C-1 只建模与回填，不发生职位变化）。 */
  reviewState: OfficialReviewState;
  /** 任职时刻（可空；开局官员置开局时刻）。 */
  appointedAt?: GameTime;
  /** 最近一次状态变化时刻（非 active 时应有）。 */
  statusChangedAt?: GameTime;
  /** 最近一次状态变化原因（非 active 时应有；active 时不设）。 */
  statusReason?: OfficialStatusReason;
  /** 死亡时刻（status=dead 时应有）。 */
  deathAt?: GameTime;
}

/** 官员四维能力（与候补 CandidateAptitude 同构；授官原样继承）。 */
export type OfficialAptitude = CandidateAptitude;

/** 官员动态履历（铨选用；PR3C-1 只建模/回填，年度考课于 PR3C-2 推进）。 */
export interface OfficialReviewState {
  /** 政绩 0–100，初始 50。 */
  merit: number;
  /** 最近一次考课年份；未考过则不设。 */
  lastReviewedYear?: number;
  /** 连续考课不合格年数。 */
  underperformanceYears: number;
}

/** 待玩家裁决的告老请求（PR2A 只生成；批准/挽留由 store 命令处理，UI 留 PR2B）。 */
export interface PendingRetirement {
  officialId: string;
  requestedAt: GameTime;
}

/** 官员状态变迁的正式历史记录（append-only；显示文本由 UI 派生）。 */
export interface OfficialHistoryEntry {
  /** "ohist_000001" 单调。 */
  id: string;
  officialId: string;
  /** 变迁后的状态。 */
  status: OfficialStatus;
  /** 变迁原因；恢复为 active 时不设。 */
  reason?: OfficialStatusReason;
  at: GameTime;
  /** 此次变迁释放的官职（离任前所占）；无则不设。 */
  vacatedPostId?: string;
  /** 由候补授官转正而来的溯源（status=active 的授官条目专有；其它条目不设）。 */
  appointment?: OfficialAppointmentProvenance;
  /** 皇帝亲发惩戒性处置（降职/免官）关联的 PunishmentRecord id；行政性变迁不设（PR3C-3a）。 */
  punishmentId?: string;
}

/** 候补授官转正的可追溯溯源（写入 officialHistory，留存科举出身）。 */
export interface OfficialAppointmentProvenance {
  candidateId: string;
  examinationYear: number;
  examinationRank: number;
  /** 授任到的官职。 */
  postId: string;
  /** 授官时的年龄快照（候补 age 自此冻结；正式官员当年龄后续随 lifecycle 增长，故只快照不约束相等）。 */
  ageAtAppointment: number;
}

// ── 候补官员（科举/荐举人才池；Phase 3 PR3A） ─────────────────────────────
/** 候补来源。 */
export type CandidateOrigin = "examination" | "recommendation";

/** 候补生命周期状态。eligible=在池可授官；appointed=已转正式官员（仅留史）；expired=逾年限退出；
 *  withdrawn=死亡/身体或其它合法退出。非 eligible 者绝不被可任命 selector 选中。 */
export type CandidateStatus = "eligible" | "appointed" | "expired" | "withdrawn";

// ── 年度吏部考课人事变动（Phase 3 PR3C-2） ───────────────────────────────
/**
 * 一次自动人事变动的种类。promotion=升迁(高品)；demotion=连年不合格降级(低品)；fill=无职在任官员补缺；
 * appointment=候补授官转正补缺。全部为**行政制度结果**，不进入 PUNISH。
 */
export type PersonnelChangeKind = "promotion" | "demotion" | "fill" | "appointment";

/** 一条自动人事变动（写入年度简报；玩家亲自惩戒不走此处，见 PR3C-3 + PUNISH）。 */
export interface PersonnelChange {
  officialId: string;
  kind: PersonnelChangeKind;
  fromPostId: string | null;
  toPostId: string | null;
  /** 由候补转正者携带其候补 id（kind=appointment 时）。 */
  candidateId?: string;
  /** 一律「制度考课」权威；绝非皇帝亲发惩罚。 */
  authority: "system_review";
}

/** 一年一度的吏部考课人事简报（只读；玩家不必逐项确认）。 */
export interface AnnualReviewRecord {
  year: number;
  at: GameTime;
  changes: PersonnelChange[];
  /**
   * 本年触发「连年不合格」阈值（被自动降级前 underperformanceYears≥阈值）的官员 id。自动降级会随即清零
   * underperformanceYears，故 PR3C-3b 的请免奏折生成需据此持久信号判定「严重失职」，而非读清零后的计数。
   */
  dismissalCandidateIds?: string[];
}

// ── 人事决策（皇帝亲裁；Phase 3 PR3C-3b） ─────────────────────────────────
/**
 * 待皇帝亲裁的人事事件种类：
 * - `consort_petition_promotion`：侍君私下请求提拔其族中官员（行政升迁，**不入 PUNISH**）。
 * - `family_implication`：侍君获罪后皇帝决定是否牵连其族中官员（牵连=亲发惩戒，**入 PUNISH**）。
 * - `memorial_promotion` / `memorial_demotion` / `memorial_dismissal`：紫宸殿人事奏折（荐升/请降/请免）。
 *
 * 升迁批准 → `promoteOfficialAdministratively`（行政，不创建 PunishmentRecord）；
 * 降职/免官批准 → `punishOfficial`（皇帝亲发惩戒，进 PUNISH）。所有职位变更**只**经这两个正式 API。
 */
export type PersonnelDecisionKind =
  | "consort_petition_promotion"
  | "family_implication"
  | "memorial_promotion"
  | "memorial_demotion"
  | "memorial_dismissal";

/**
 * 一次人事决策的裁断。`approve`/`reject` 用于升迁请求与荐升/请降/请免奏折（approve=准奏）；
 * `spare`/`demote`/`dismiss` 用于侍君获罪牵连（spare=罪止其身，demote=降职，dismiss=免官）。
 */
export type PersonnelDecisionResolution = "approve" | "reject" | "spare" | "demote" | "dismiss";

/**
 * 待裁/已裁的人事决策（pending 可存档；resolved 不可再次执行）。`sourceId` 为去重键（同源不重复创建）；
 * `id`（"pdec_000001"）为存储键，与 record key 一致。事件与 UI 绝不直接改 postId / officialHistory /
 * justice.punishments——一律经 resolvePersonnelDecision 调用正式职位 API。
 */
export interface PersonnelDecision {
  /** "pdec_000001" 单调；与 record key 一致。 */
  id: string;
  kind: PersonnelDecisionKind;
  status: "pending" | "resolved";
  createdAt: GameTime;
  /** 去重键：同一 sourceId 全局至多一条（无论 pending/resolved）。 */
  sourceId: string;
  /** 职位可能变更的官员。 */
  officialId: string;
  /** 相关侍君：请求者（petition）或获罪牵连者（family_implication）。 */
  consortId?: string;
  /** 相关家族（官员母族）。 */
  familyId?: string;
  /** 创建时官员当前官职快照（叙述/展示用；执行以实时 state 为准）。 */
  fromPostId?: string;
  /** 建议目标官职（升迁/降职）。免官无此字段。 */
  recommendedPostId?: string;
  /** family_implication 的来源侍君 punishment（必须指向真实 consort 目标记录）。 */
  sourcePunishmentId?: string;
  /** 关联案件（可选，溯源用）。 */
  caseId?: string;
  /** 裁断时刻（resolved 必填，不早于 createdAt）。 */
  resolvedAt?: GameTime;
  /** 裁断结果（resolved 必填，且须与 kind 合法）。 */
  resolution?: PersonnelDecisionResolution;
}

// ── 国库台账（Phase 4B） ──────────────────────────────────────────────────
/**
 * 国库流水台账条目。每次奏折批阅产生一条（delta 非零），原子写入，append-only。
 * 绝不手动修改；验证见 treasuryLedger.ts。
 */
export interface TreasuryLedgerEntry {
  /** "tre_000001" 格式，全局唯一。 */
  id: string;
  at: GameTime;
  /** 非零安全整数；负数=支出，正数=收入。 */
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  source:
    | { kind: "memorial"; memorialId: string; optionId: string }
    | { kind: "shop_purchase"; itemId: string }
    | { kind: "system"; reasonCode: string };
  reason: string;
}

// ── 边情评估（Phase 4C） ──────────────────────────────────────────────────
export type FrontierTheaterId =
  | "northern_frontier"
  | "western_frontier"
  | "southern_frontier";

export type FrontierSeverity =
  | "stable"
  | "watch"
  | "urgent"
  | "critical";

export interface FrontierAssessment {
  id: string;
  year: number;
  assessedAt: GameTime;
  theaterId: FrontierTheaterId;

  pressureBefore: number;
  pressureDelta: number;
  pressureAfter: number;

  militaryAtAssessment: number;
  governanceAtAssessment: number;
  publicSupportAtAssessment: number;

  severity: FrontierSeverity;

  generation:
    | { status: "generated"; memorialId: string }
    | { status: "blocked_by_pending"; blockingMemorialId: string };
}

// ── 奏折框架（Phase 4A 第一刀） ─────────────────────────────────────────
/**
 * 紫宸殿奏折类别。第一刀只实地实现 `disaster`（地方灾情）；其余为框架占位（不生成），人事奏折仍由
 * PR3C-3b 的 personnelDecisions 承载，待统一列表后再并入。
 */
export type MemorialCategory = "personnel" | "treasury" | "disaster" | "military" | "justice";

/** 奏折后果效果（仅 resource：funnel 可寻址的 nation/sovereign 字段）。批阅时按 EventEffect 经漏斗施加。 */
export interface MemorialResourceEffect {
  type: "resource";
  pillar: "sovereign" | "nation";
  field: string;
  delta: number;
}

/**
 * 奏折处置选项（通用）：选定后经 effect funnel 施加国家/皇帝属性变化（绝不直接改 state）。
 * treasuryDelta 若存在，表示国库变动（负=支出，正=收入）；为 undefined 则无国库变化。
 */
export interface MemorialOption {
  /** 选项 id（同一奏折内唯一）；resolved 时写入 Memorial.resolution。 */
  id: string;
  label: string;
  effects: MemorialResourceEffect[];
  /** 非零安全整数；负=支出；undefined=无国库变化。 */
  treasuryDelta?: number;
}
/** 向后兼容别名（第一刀的 DisasterOption 直接映射到 MemorialOption）。 */
export type DisasterOption = MemorialOption;

/** 各项季度支出的细分金额（计划/实付/缺口共用此形状）。 */
export interface QuarterlyExpenseBreakdownFields {
  palace: number;
  consortAllowance: number;
  officialSalary: number;
  armyMaintenance: number;
  royalChildrenEducation: number;
}

/**
 * 税收因子归因（正=增益，负=拖累）。
 * PR #82 将扩展 type 支持 "disaster" / "tax_relief" 等新类型。
 */
export interface QuarterlyRevenueCause {
  type: "productivity" | "corruption" | "public_support" | "border_pressure" | "random";
  /** actual - actual_if_this_factor_were_neutral(1.0)。负数代表该因素拖累了税收。 */
  impact: number;
}

/** 财政奏折载荷（年度岁入计划 / 季度财政简录）。 */
export type TreasuryMemorialPayload =
  | {
      category: "treasury";
      matter: "annual_revenue_plan";
      urgency: "routine" | "urgent";
      options: MemorialOption[];
    }
  | {
      category: "treasury";
      matter: "quarterly_settlement_report";
      /** 季节标签，如"春"/"夏"/"秋"/"冬"。 */
      season: string;
      /** "${year}:${month}" 格式，用于历史查询。 */
      periodKey: string;
      openingTreasury: number;
      revenueBase: number;
      revenueActual: number;
      /** 各税收因子的实际归因（impact≠0 的因子）。 */
      revenueCauses: QuarterlyRevenueCause[];
      expensePlanned: number;
      expensePaid: number;
      /**
       * 本季未能拨付的支出总额（expensePlanned - expensePaid）。
       * 仅代表本季度缺口，不构成跨季度债务。
       * 下一季度用度政策将反映实际供给减少（PR #81）。
       */
      fundingShortfall: number;
      /** 按优先级分配后的各项计划/实付/缺口明细。 */
      expenseAllocation: {
        planned: QuarterlyExpenseBreakdownFields;
        paid: QuarterlyExpenseBreakdownFields;
        shortfall: QuarterlyExpenseBreakdownFields;
      };
      closingTreasury: number;
      options: MemorialOption[];
    };

export type MilitaryMemorialMatter =
  | "annual_readiness"
  | "border_fortification"
  | "frontier_incursion";

export type MilitaryMemorialUrgency =
  | "routine"
  | "urgent"
  | "critical";

export interface MilitaryMemorialPayload {
  category: "military";
  matter: MilitaryMemorialMatter;
  urgency: MilitaryMemorialUrgency;
  theaterId: FrontierTheaterId;
  pressureAtCreation: number;
  militaryAtCreation: number;
  options: MemorialOption[];
}

/** 各类别的结构化载荷（判别联合）。 */
export type MemorialPayload =
  | { category: "disaster"; regionId: string; severity: "minor" | "major"; options: MemorialOption[] }
  | TreasuryMemorialPayload
  | MilitaryMemorialPayload;

/**
 * 待皇帝批阅/已批阅的奏折（pending 可存档；resolved 不可再次执行）。`sourceId` 为去重键；`id`（"mem_000001"）
 * 为存储键，与 record key 一致。后果一律经正式 effect funnel，事件/UI 绝不直接改 state。
 */
export interface Memorial {
  id: string;
  category: MemorialCategory;
  status: "pending" | "resolved";
  createdAt: GameTime;
  sourceId: string;
  title: string;
  summary: string;
  payload: MemorialPayload;
  resolvedAt?: GameTime;
  /** 选定的 optionId（须属 payload 合法选项集）。 */
  resolution?: string;
}

/** 候补能力（0–100）。任命时按官职类型匹配（匹配评分留 PR3B），PR3A 只生成保存。 */
export interface CandidateAptitude {
  governance: number; // 政略/治理
  scholarship: number; // 才学
  military: number; // 军事
  integrity: number; // 清正
}

/**
 * 候补者**不是官员**：不占官位、不入官员名册、不参与官员年度告老、不被在任官员 selector 选中、
 * 不因入池获得 structured official claim。女性限定（无 sex 字段即女性）。
 */
export interface OfficialCandidate {
  id: string; // "cand_<year>_<index>"，全局唯一，与官员/角色/成员 id 命名空间隔离
  surname: string;
  givenName: string;
  age: number;
  /** 关联已有官员家族 id；寒门/无背景则 null。关联时绝不伪造新亲缘边。 */
  familyId: string | null;
  origin: CandidateOrigin;
  examinationYear: number;
  /** 本年榜次（1 起，同年唯一且连续）。 */
  examinationRank: number;
  aptitude: CandidateAptitude;
  status: CandidateStatus;
  enteredPoolAt: GameTime;
  /** 逾此年（含）未授官则 expired。 */
  expiresAtYear: number;
  /** appointed 后指向转正的正式官员 id（可追溯）。 */
  appointedOfficialId?: string;
}

/** 一年一度的科举结果（榜单）。acknowledged 由 PR3B 玩家查看后置 true。 */
export interface ExaminationResult {
  year: number;
  generatedAt: GameTime;
  candidateIds: string[];
  acknowledged: boolean;
}

/** 官员所属部门（官职归类；驱动名册分组，本阶段不参与数值）。 */
export type OfficialDepartment =
  | "chancellery" // 相/政事堂（丞相、三公）
  | "personnel" // 吏部
  | "revenue" // 户部
  | "rites" // 礼部
  | "military" // 兵部/都督府/卫所
  | "justice" // 刑部/大理寺
  | "works" // 工部
  | "censorate" // 御史台（监察）
  | "academy" // 太常寺/宗正寺/国子监
  | "provincial" // 布政/按察/府州县
  | "none"; // 平民（无部门）

/** 官员家族成员的身份（非官员、非宫中侍君的辅助人物）。 */
export type FamilyMemberRole =
  | "matriarch" // 上一代家主/母亲
  | "consort_in" // 内卿（官员正室，男性）
  | "daughter" // 女儿
  | "son" // 男郎（男性子嗣）
  | "sister"; // 姐妹

export type PersonSex = "female" | "male";

/**
 * 家族辅助成员（最小人物结构）。统一人物模型缺位时仅为「非官员/非在宫侍君」的近亲建模：
 * 官员本人用 Official、宫中侍君用 CharacterContent+standing；母亲/内卿/女儿/男郎/姐妹用此。
 * id 全局唯一且与 Official/角色 id 命名空间隔离（person_*），改名不改 id。
 */
export interface FamilyMember {
  id: string;
  familyId: string;
  name: string; // 显示名（姓+名 或 名）
  surname: string;
  sex: PersonSex;
  age: number;
  role: FamilyMemberRole;
  /** 死亡时刻（自然死亡标记）。设后不再增龄，但绝不删除——亲缘/家族关系保留。 */
  deceasedAt?: GameTime;
}

/**
 * 官员家族（长期政治/亲缘实体）。influence=门第影响、imperialFavor=皇帝整体态度，
 * 二者与官员个人 loyalty、与官职品级均分离。
 *
 * 成员归属唯一真相：各人物自身的 familyId（Official/FamilyMember）与 standing.birthFamilyId
 * （侍君）。家族不另存 memberIds——成员列表一律经 selector 派生，杜绝重复存储与漂移。
 */
export interface OfficialFamily {
  id: string;
  surname: string;
  influence: number; // 0–100 家族权势/门第影响（非官职品级）
  imperialFavor: number; // 0–100 皇帝当前对该族整体态度
}

/** 亲缘关系类型。语义：`type` 描述「to 相对于 from」的身份（如 mother=「to 是 from 的母亲」）。 */
export type KinshipType =
  | "mother" // to 是 from 的母亲
  | "daughter" // to 是 from 的女儿
  | "son" // to 是 from 的男郎（子）
  | "sibling" // to 与 from 互为同胞（对称）
  | "spouse" // to 与 from 互为配偶（对称）
  | "close_relative"; // 其它近亲（姨母/姑母…，本阶段预留）

/** 一条有向亲缘边。正反方向均落库（对称关系 sibling/spouse 也存两条等价边）。 */
export interface KinshipRelation {
  fromPersonId: string;
  toPersonId: string;
  type: KinshipType;
}

export type ConsortLifecycle = "normal" | "candidate" | "carrying" | "delivered" | "deceased";

/** 后宫居所内的宫室槽位（每殿至多 5 间，各住一名侍君）；缺省视作 "main"(主殿)。 */
export type ChamberId = "main" | "east_side" | "west_side" | "east_annex" | "west_annex";

/** 侍君人格特质（八维，藏匿，稳定）。范围 0–100。 */
export interface ConsortPersonality {
  intelligence: number;       // 谋略推理
  scheming: number;           // 心机算计
  sociability: number;        // 交际亲和
  compassion: number;         // 慈悲同理
  courage: number;            // 胆识敢为
  jealousy: number;           // 嫉妒竞争
  emotionalStability: number; // 情绪调节
  pride: number;              // 自尊尊严
}

/** 侍君宫室状况（藏匿；运行时可调）。范围 0–100。 */
export interface ConsortHousehold {
  servantOpinion: number;    // 宫人集体观感
  livingStandard: number;    // 实际生活水平（非位分官方标准）
  privateWealthLevel: number; // 私家经济能力等级（非精确货币；代表嫁妆/家援/贵重品/场外资源综合）
}

export interface CharacterStanding {
  /** Rank id from world.json's 位分 table. */
  rank: string;
  /** 0–100 — 恩宠 (consort) / 圣眷 (official). */
  favor: number;
  /** 历史最高恩宠；初始等于 favor，只升不降。0 <= favor <= peakFavor <= 100 */
  peakFavor: number;
  /** 封号 (optional). */
  title?: string;
  /** 承嗣生命周期标记（缺省视作 "normal"）。 */
  lifecycle?: ConsortLifecycle;
  /** 产后休养（虚弱）截止月序 monthOrdinal；未达则激情不可选。 */
  recoverUntilMonth?: number;
  /** 所居宫殿（locationId）；缺省回退 content 的 defaultLocation。搬迁改写此处。 */
  residence?: string;
  /** 所居宫室（缺省 "main" 主殿）。 */
  chamber?: ChamberId;
  /** 好感/情意 0–100（仅侍君；缺省回退 authored hidden.affection）。 */
  affection?: number;
  /** 恐惧 0–100（仅侍君；缺省回退 hidden.fear，无则 30）。 */
  fear?: number;
  /** 野心 0–100（仅侍君；缺省回退 hidden.ambition，无则 35）。 */
  ambition?: number;
  /** 忠诚 0–100（仅侍君；缺省回退 hidden.loyalty，无则 50）。 */
  loyalty?: number;
  /** 后宫阵营标识（可选；预置角色通过 initialStanding.haremFactionId authored）。 */
  haremFactionId?: string;
  /** 入宫时刻（知情资格用）；非常住者 undefined。所有入宫流程必须写此字段。 */
  palaceEnteredAt?: GameTime;
  /** 殿选新晋侍君的侍寝解禁月序（monthOrdinal）；缺省即无门槛。 */
  availableFromMonth?: number;
  /** 运行时数值健康 0–100（侍君；初始取 attributes.health；官员无此字段）。 */
  health?: number;
  /** 病情状态（健康/生病/重病；官员无此字段）。 */
  healthStatus?: HealthStatus;
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
  /** 动态入宫侍君的入宫年龄（选秀用）；预置侍君用 profile.age。 */
  ageAtEntry?: number;
  /** 动态入宫侍君的入宫年份。 */
  enteredAtYear?: number;
  /** 身后事记录（死后写入，绝不覆盖生前 rank/title）。 */
  deathRecord?: DeathRecord;
  /** 母族（官员家族）id；出身平民/良家子则 undefined。开局生成流程统一写入。 */
  birthFamilyId?: string;
  /** 人格特质（藏匿；稳定；新游戏从 hidden.personality 或默认值实化）。 */
  personality?: ConsortPersonality;
  /** 宫室状况（藏匿；运行时可调；始终从默认值实化）。 */
  household?: ConsortHousehold;
}

// ── Memory (PR2: 活人感形状) ──────────────────────────────────────────
export type MemoryKind =
  | "episodic" | "trauma" | "grievance" | "gratitude" | "promise" | "secret" | "impression";
export type MemoryPerspective =
  | "actor" | "target" | "witness" | "parent" | "ally" | "enemy" | "relative";
export type MemoryEmotion =
  | "joy" | "grief" | "fear" | "anger" | "envy" | "shame" | "guilt" | "relief";

export interface MemoryEntry {
  id: string;
  ownerId: string;
  kind: MemoryKind;
  /** 关联 chronicle CourtEvent（可空）。 */
  sourceEventId?: string;
  /** 司法溯源（可选；不自动授权角色知识/claim）。 */
  sourcePunishmentId?: string;
  sourceCaseId?: string;
  /** 涉及的当事人（取代 participants）。 */
  subjectIds: string[];
  perspective: MemoryPerspective;
  /** ≤240，POV。 */
  summary: string;
  /** 0–100，记忆牢固度（取代 salience）。 */
  strength: number;
  /** permanent 取代 protected。 */
  retention: MemoryRetention;
  emotions: Partial<Record<MemoryEmotion, number>>;
  /** 取代 tags（≤5）。 */
  triggerTags: string[];
  unresolved: boolean;
  createdAt: GameTime;
}

export interface CharacterMemoryStore {
  entries: MemoryEntry[];
  nextSeq: number;
}

export type EmotionalConditionType =
  | "acute_grief" | "prolonged_grief" | "resentment" | "anxiety" | "infatuation" | "humiliation";

export interface EmotionalCondition {
  id: string;                 // "cond_<ownerId>_000001"
  ownerId: string;
  type: EmotionalConditionType;
  sourceEventId: string;
  severity: number;           // 0–100
  startedAt: GameTime;
  recoveryProfile: "fast" | "normal" | "slow" | "stuck";
}

// ── 记忆提及日志（PR4：冷却惩罚） ────────────────────────────────────────
export interface MemoryMentionRecord {
  speakerId: string;
  audienceId: string;
  memoryId: string;
  mentionedAt: GameTime;
}

// ── 事件反应日志（T2：去重 + 冷却） ──────────────────────────────────────
/** 已发生过的「说者→听者 对同一事件的反应」去重记录。 */
export interface EventReactionRecord {
  /** 发言角色 charId。 */
  speakerId: string;
  /** 倾听角色 charId（通常为皇帝）。 */
  audienceId: string;
  /** 对应 CourtEvent.id。 */
  eventId: string;
  /** 反应发生时刻。 */
  reactedAt: GameTime;
}

export type BedchamberMode = "passion" | "pleasure" | "companionship";

export interface BedchamberEncounter {
  /** 侍寝发生时刻（纯 GameTime，不带 AP） */
  at: GameTime;
  mode: BedchamberMode;
}

export interface BedchamberRecord {
  /** append-only */
  encounters: BedchamberEncounter[];
}

export interface DeathRecord {
  diedAt: GameTime;
  cause: DeathCause;
  /** 生前位分/封号快照。 */
  originalRankId: string;
  originalTitle?: string;
  /** 追封位分/谥号（生前数据不动）。 */
  posthumousRankId?: string;
  posthumousEpithet?: string;
}

export interface PendingAftermath {
  /** 稳定 id：death:{kind}:{subjectId}:{deathDayIndex}（幂等去重）。 */
  id: string;
  kind: "taihou" | "consort" | "heir";
  subjectId: string;
  at: GameTime;
  resolved: boolean;
}

// ── 冷宫事件通报（PUNISH-4C / PUNISH-4D）──────────────────────────────────
// ── PUNISH-4E: Cold-palace intervention records ──────────────────────────────

export type ColdPalaceInterventionKind = "personal_visit" | "physician";

interface ColdPalaceInterventionBase {
  /** Canonical ID: cpa_{residentId}_{year}_{MM} — at most one per resident per month. */
  id: string;
  residentId: string;
  /** ID of the ColdPalaceEffect active when this intervention was performed. */
  effectId: string;
  occurredAt: GameTime;
}

export interface ColdPalaceVisitIntervention extends ColdPalaceInterventionBase {
  kind: "personal_visit";
  favorDelta: number;
}

export interface ColdPalacePhysicianIntervention extends ColdPalaceInterventionBase {
  kind: "physician";
  healthDelta: number;
}

export type ColdPalaceIntervention =
  | ColdPalaceVisitIntervention
  | ColdPalacePhysicianIntervention;

// ── ColdPalaceIncident (PUNISH-4C/4D) ───────────────────────────────────────

export type ColdPalaceIncidentKind = "petition" | "health_deterioration" | "critical_illness" | "mental_breakdown";

/** Player choice when resolving a critical_illness incident. */
export type ColdPalaceIncidentResolution = "physician" | "ignore" | "restored";

// Shared base for all cold-palace incident variants.
interface ColdPalaceIncidentBase {
  /** "cpi_{residentId}_{year}_{MM}" — deterministic, idempotent dedup key. */
  id: string;
  residentId: string;
  /** id of the ColdPalaceEffect active when this incident was generated. */
  effectId: string;
  occurredAt: GameTime;
  /** false = awaiting player acknowledgement; true = already presented. */
  acknowledged: boolean;
}

/** Pure narrative report — no health change. */
export interface ColdPalacePetitionIncident extends ColdPalaceIncidentBase {
  kind: "petition";
}

/** Monthly health tick applied a negative delta (non-lethal) at generation time. */
export interface ColdPalaceHealthDeteriorationIncident extends ColdPalaceIncidentBase {
  kind: "health_deterioration";
  /** Always negative. Applied at tick time via planHealthChange (non-lethal). */
  healthDelta: number;
}

/**
 * Serious illness requiring player decision (PUNISH-4D two-phase model).
 * Generated when health ≤ CRITICAL_HEALTH_THRESHOLD; NO health effect at tick time.
 * Player resolves via resolveColdPalaceCriticalIncident(); health effect applied then.
 */
export interface ColdPalaceCriticalIllnessIncident extends ColdPalaceIncidentBase {
  kind: "critical_illness";
  /** "pending_response" = awaiting player decision; "resolved" = player chose. */
  status: "pending_response" | "resolved";
  resolution?: ColdPalaceIncidentResolution;
  resolvedAt?: GameTime;
  /** Set at resolution time: positive (physician recovery) or negative (ignore penalty). */
  healthDelta?: number;
}

/** Permanent mental breakdown — no resolution needed, just acknowledge. */
export interface ColdPalaceMentalBreakdownIncident extends ColdPalaceIncidentBase {
  kind: "mental_breakdown";
  /** Links to the ColdPalaceMadnessEffect created simultaneously. */
  madnessEffectId: string;
}

export type ColdPalaceIncident =
  | ColdPalacePetitionIncident
  | ColdPalaceHealthDeteriorationIncident
  | ColdPalaceCriticalIllnessIncident
  | ColdPalaceMentalBreakdownIncident;

// ── 角色持续状态（可复用：禁足 / 后续冷宫·下狱·守丧·卧病）─────────────────
// 单一权威的「持续效果」时间线：append-mostly，解除时就地标记 lifted 而非物理删除，
// 以保留历史。活跃判定只依据 startTurn/endTurnExclusive/liftedTurn，不存「剩余月份」。
export type StatusEffectKind = "confinement" | "cold_palace" | "cold_palace_madness";

/** 禁足解除原因：皇帝下旨 / 期满自动到期。 */
export type ConfinementLiftReason = "lifted_by_emperor" | "term_expired";

export interface ConfinementEffect {
  /** "status_<charId>_000001" 单调。 */
  id: string;
  kind: "confinement";
  characterId: string;
  /** 下旨当旬（含；当前旬即第一旬）。 */
  startTurn: number;
  /** 自动到期旬（独占上界）；null = 无诏不得出，不自动到期。 */
  endTurnExclusive: number | null;
  imposedAt: GameTime;
  imposedBy: "emperor";
  /** 下旨发生地（紫宸殿 / 侍君宫殿）。 */
  sourceLocation?: string;
  /** 解除时刻（手动或到期）；未解除则 undefined。 */
  liftedAt?: GameTime;
  /** 解除生效旬；未解除则 undefined。手动解除 = 当旬；到期 = endTurnExclusive。 */
  liftedTurn?: number;
  liftReason?: ConfinementLiftReason;
  /** Links to PunishmentRecord.id for lifecycle reconciliation. */
  sourcePunishmentId?: string;
}

export type ColdPalaceLiftReason = "lifted_by_emperor" | "pardoned" | "death";

export interface ColdPalaceEffect {
  /** "status_<charId>_NNNNNN" 单调。 */
  id: string;
  kind: "cold_palace";
  characterId: string;
  startedAt: GameTime;
  startTurn: number;
  previousResidenceId: string;
  previousChamber?: ChamberId;  // undefined means "main" (default)
  coldPalaceResidenceId: string;
  sourcePunishmentId: string;
  liftedAt?: GameTime;
  liftedTurn?: number;
  liftReason?: ColdPalaceLiftReason;
}

export interface ColdPalaceMadnessEffect {
  /** "status_<charId>_NNNNNN" — uses existing nextStatusEffectId sequence. */
  id: string;
  kind: "cold_palace_madness";
  characterId: string;
  /** The ColdPalaceEffect that was active when mental breakdown was triggered. */
  sourceColdPalaceEffectId: string;
  startedAt: GameTime;
  startTurn: number;
  // Permanent and irrevocable: no liftedAt, liftedTurn, or sourcePunishmentId ever set.
}

/** 角色持续状态的判别联合（禁足 / 冷宫；下狱/守丧待扩展）。 */
export type CharacterStatusEffect = ConfinementEffect | ColdPalaceEffect | ColdPalaceMadnessEffect;

// ── 太后（尊长）状态 ──────────────────────────────────────────────────
export interface TaihouState {
  /** 运行时数值健康 0–100（初始 70）。 */
  health: number;
  /** 病情状态。 */
  healthStatus: HealthStatus;
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
  /** 是否已薨。 */
  deceased?: boolean;
  /** 薨逝时刻。 */
  diedAt?: GameTime;
  /** 谥号（1–2 字）。 */
  posthumousName?: string;
  /** 服丧截止 dayIndex（独占上界 = deathDayIndex + 3，含死亡当日）。 */
  mourningUntilDayExclusive?: number;
}

// ── The single authoritative state ────────────────────────────────────
export type FlagValue = boolean | number | string;

export interface EventLogEntry {
  eventId: string;
  firedAt: GameTime;
}

// ── 客观事件编年史（严格 append-only；独立于 eventLog 的事件触发记账）─────
export type CourtEventType =
  | "residence_changed"
  | "heir_born"
  | "heir_died"
  | "rank_changed"
  | "punished"
  | "rewarded"
  | "conflict"
  | "promise"
  | "secret_discovered"
  | "harem_administration_changed"
  | "heir_custody_changed"
  | "intrigue_discovered";
// claim_corrected 延后到【首个有错误信念/可证伪 claim 的 PR】——它需生产者+消费者；
// 加入即死类型。

/** 公共/私人记忆共用的衰减档位。 */
export type MemoryRetention = "fast" | "slow" | "permanent";

/** contemporaneous=仅事发时在范围内者默认知道；institutional=后来进入者也默认知道。 */
export type KnowledgePersistence = "contemporaneous" | "institutional";

/** 判别联合：无效组合在数据入口即失败。v1 不允许 realm+contemporaneous。 */
export type CourtEventPublicity =
  | { scope: "circle"; circleIds: string[] }
  | { scope: "palace"; persistence: KnowledgePersistence }
  | { scope: "realm"; persistence: "institutional" };

export interface CourtEventParticipant {
  charId: string;
  /** 显式角色，不靠数组位置：birth_father / adoptive_father / sovereign_parent / newborn / demoted / … */
  role: string;
}

/** 一条不可变的「曾经发生过什么」。append-only，永不回写；更正用 claim_corrected 新事件。 */
export interface CourtEvent {
  /** "evt_000001"，由现有最大序号 +1 派生。 */
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];
  locationId?: string;
  /** 仅非角色标量（birthOrder/sex/from-to rank …）。 */
  payload: Record<string, unknown>;
  publicity: CourtEventPublicity;
  /** 0–100 公共显著度。 */
  publicSalience: number;
  /** 公共事件也参与有效强度衰减（与私人记忆同一检索公式）。 */
  retention: MemoryRetention;
  tags: string[];
  /** 司法溯源链接（可选；不自动授权角色知识）。 */
  links?: JusticeLinks;
}

/**
 * 后宫主理权变动原因。
 *   empress_confined      — 皇后被禁足，交由侍君或内务府代理。
 *   empress_illness       — 皇后抱恙（sick/critical），暂交代理（行政性，非处罚）。
 *   imperial_deprivation  — 皇后健康，皇帝主动收回主理权（处罚性）。
 *   no_eligible_consort   — 无合格候选侍君，转内务府代理（常与上述原因共存）。
 *   imperial_reassignment — 已有代理时，皇帝改派另一代理者（行政性重新委任）。
 */
export type HaremAdministrationReason =
  | "empress_confined"
  | "empress_illness"
  | "imperial_deprivation"
  | "no_eligible_consort"
  | "imperial_reassignment";

/** 六宫年度例核结果。 */
export type HaremAdminReviewOutcome =
  | "rank_changed"     // 选出候选并成功执行位分变动
  | "no_candidate"     // 无合格候选（已在窗口期，但决策引擎返回 null）
  | "no_administrator"; // 当前无有效主理人（neiwu_proxy 模式）

/** rank_changed 时保存的决策快照（来自 PR #75 HaremAdminDecision）。 */
export interface HaremAdminDecisionSnapshot {
  targetId: string;
  direction: "promote" | "demote";
  fromRankId: string;
  toRankId: string;
  /** 原因（不再从 score 倒推；在候选生成时确定）。 */
  reason: "service_merit" | "household_order" | "disloyalty" | "household_disorder";
  score: number;
}

/**
 * 六宫年度例核记录。
 * - 每年至多一条（hasHaremAdminReviewForYear 保证幂等）。
 * - rank_changed && acknowledged=false 时乘风禀报尚未呈报，构成全局中断。
 * - no_candidate / no_administrator 仅作幂等标记，直接 acknowledged=true。
 */
export interface HaremAdminReviewRecord {
  id: string;
  year: number;
  outcome: HaremAdminReviewOutcome;
  /** rank_changed 时记录执行者 charId。 */
  administratorId?: string;
  /** rank_changed 时记录执行者职务。 */
  office?: "empress" | "acting_consort";
  /** rank_changed 时保存完整决策快照。 */
  decision?: HaremAdminDecisionSnapshot;
  settledAt: GameTime;
  acknowledged: boolean;
}

// ── PUNISH-4G-B: 后宫内部惩戒 ─────────────────────────────────────────────────

/** 惩戒手段：抄写经文（最轻）、罚跪、掌嘴（最重）。 */
export type HaremDisciplineKind = "copy_scripture" | "kneeling" | "slapping";

/** 陛下对内部惩戒的御前裁断。 */
export type HaremDisciplineResolution =
  | "upheld"        // 维持处分
  | "protected"     // 回护受罚者
  | "rebuked_both"; // 各自申饬

/** 施罚者快照（结算时冻结）。 */
export interface HaremDisciplineActorSnapshot {
  rankId: string;
  favor: number;
  peakFavor: number;
  imperialProtectionScore: number;
  isHaremAdministrator: boolean;
}

/** 受罚者快照（结算时冻结）。 */
export interface HaremDisciplineTargetSnapshot {
  rankId: string;
  favor: number;
  peakFavor: number;
  imperialProtectionScore: number;
  isCarrying: boolean;
  healthBefore: number;
}

/**
 * 后宫内部惩戒事件（append-only；同 coldPalaceIncidents 模式）。
 * - status=pending_response: 已发生、尚未呈报陛下 → 构成全局中断 harem_discipline
 * - status=resolved: 陛下已裁断
 */
export interface HaremDisciplineIncident {
  id: string;
  actorId: string;
  targetId: string;
  disciplineKind: HaremDisciplineKind;
  occurredAt: GameTime;
  actorSnapshot: HaremDisciplineActorSnapshot;
  targetSnapshot: HaremDisciplineTargetSnapshot;
  /** 发生时写入的后宫冲突 CourtEvent id。 */
  courtEventId: string;
  status: "pending_response" | "resolved";
  resolution?: HaremDisciplineResolution;
  resolvedAt?: GameTime;
  /** 御前裁断事件 id（status=resolved 时必须存在）。 */
  resolutionEventId?: string;
}

// ── 后宫主理权 ─────────────────────────────────────────────────────────────────

/**
 * 后宫主理权运行态。
 *   empress        — 皇后正常掌宫（默认）。
 *   acting_consort — 由某位侍君奉旨协理。
 *   neiwu_proxy    — 无合格侍君，内务府暂代宫务。
 */
export type HaremAdministrationState =
  | { mode: "empress" }
  | {
      mode: "acting_consort";
      charId: string;
      appointedAt: GameTime;
      reason: HaremAdministrationReason;
    }
  | {
      mode: "neiwu_proxy";
      appointedAt: GameTime;
      reason: HaremAdministrationReason;
    };

/** 宫斗阴谋持久化记录（Phase 5A-2）。 */
export interface HaremScheme {
  /** "scheme_{year}_{MM}_{actorId}_{targetId}" */
  id: string;
  /** "harem_intrigue:{year}:{MM}" — 幂等键 */
  sourceKey: string;
  plan: HaremIntriguePlan;
  status: "pending" | "resolved" | "cancelled";
  outcome?: HaremIntrigueOutcome;
  scheduledForYear: number;
  scheduledForMonth: number;
}

/** 事件当时产生了何种可见迹象（冻结于 settlement 时，不可事后重算）。 */
export type HaremIntrigueObservationLevel = "none" | "anomaly" | "rumor" | "exposed";

/** 宫斗结果事件记录（Phase 5A-3a）。 */
export interface HaremIncident {
  /** "incident_{schemeId}" */
  id: string;
  schemeId: string;
  kind: HaremIntrigueKind;
  /** 后台真相：真实主谋。不得直接传给 UI。 */
  actorId: string;
  targetId: string;
  success: boolean;
  /** 事件可见程度（后台记录；玩家只通过 HaremIntrigueReport 知道）。 */
  observationLevel: HaremIntrigueObservationLevel;
  resolvedAt: GameTime;
  consequencesApplied: boolean;
  /** 败露时写入的 CourtEvent ID（可选）。 */
  courtEventId?: string;
}

/** 宫斗情报报告种类（Phase 5A-3a）。 */
export type HaremIntrigueReportKind =
  | "anomaly"           // 有异常但不知主谋
  | "rumor"             // 宫中风闻
  | "exposure"          // 完整败露
  | "investigation_update"   // 调查进展（5B-2）
  | "investigation_final";   // 调查终报（5B-2）

/** 宫斗情报报告状态（玩家视角）。 */
export type HaremIntrigueReportStatus = "unread" | "seen" | "actioned" | "archived";

/** 玩家对结果的知情程度。 */
export type HaremIntrigueKnownOutcome = "unknown" | "harm_observed" | "attempt_observed";

/** 情报可信度（玩家视角，非后台真实可靠度）。 */
export type HaremIntrigueReportConfidence = "tenuous" | "plausible" | "strong" | "confirmed";

/**
 * 宫斗情报报告：玩家知识层（Phase 5A-3a）。
 * 不存 actorId 真相；只暴露玩家实际得知的内容。
 */
export interface HaremIntrigueReport {
  /** "ireport_{incidentId}" */
  id: string;
  source: { incidentId: string };
  reportKind: HaremIntrigueReportKind;
  createdAt: GameTime;
  status: HaremIntrigueReportStatus;
  /** 玩家得知的受影响侍君 ID 列表。 */
  knownTargetIds: string[];
  /** 玩家怀疑的主谋列表（可为空；exposure 时才填真实 actorId）。 */
  suspectedActorIds: string[];
  /** 玩家得知的阴谋种类（可能不完整）。 */
  suspectedKinds: HaremIntrigueKind[];
  knownOutcome: HaremIntrigueKnownOutcome;
  confidence: HaremIntrigueReportConfidence;
  /** 结构化模板代码，UI 据此生成文案（不持久化自由文本）。 */
  summaryCode: string;
  acknowledgedAt?: GameTime;
  action?: "dismissed" | "watching" | "investigating" | "summoned";
  linkedInvestigationId?: string;
}

/** 对话历史日志条目：记录每次播放反应时的发言人与台词，上限 NARRATIVE_LOG_MAX 条，先进先出。 */
export interface NarrativeEntry {
  /** 游戏时间（存档时的 calendar 日历）。 */
  at: GameTime;
  /** 发言人 charId（系统/旁白使用 "narrator"）。 */
  speakerId: string;
  /** 台词（可多行）。 */
  lines: string[];
}

export const NARRATIVE_LOG_MAX = 300;

export interface GameState {
  calendar: CalendarState;
  playerLocation: string;
  taihou: TaihouState;
  resources: Resources;
  flags: Record<string, FlagValue>;
  standing: Record<string, CharacterStanding>;
  /** 殿选运行时生成并落库的侍君（content 之外）；App 合并进 db.characters。 */
  generatedConsorts: Record<string, CharacterContent>;
  officials: Record<string, Official>;
  /** 官员家族（母系实体）；开局生成，随存档持久化。 */
  officialFamilies: Record<string, OfficialFamily>;
  /** 家族辅助成员（母亲/内卿/女儿/男郎/姐妹）；官员与宫中侍君不在此。 */
  familyMembers: Record<string, FamilyMember>;
  /** 亲缘关系边（正式可查询，绝不靠姓名临时推断）。 */
  kinship: KinshipRelation[];
  /** 待裁决的告老请求（年度 tick 生成；批准→retired / 挽留→撤回）。 */
  pendingRetirements: PendingRetirement[];
  /** 官员状态变迁历史（append-only，可见历史）。 */
  officialHistory: OfficialHistoryEntry[];
  /** 候补官员池（科举/荐举；与正式 officials 隔离）。 */
  officialCandidates: Record<string, OfficialCandidate>;
  /** 历年科举结果（append-only 榜单）。 */
  examinationResults: ExaminationResult[];
  /** 历年吏部考课人事简报（append-only，只读）。 */
  annualReviews: AnnualReviewRecord[];
  /** 待皇帝亲裁/已裁的人事决策（侍君请提拔亲族 / 获罪牵连 / 紫宸殿人事奏折；PR3C-3b）。 */
  personnelDecisions: Record<string, PersonnelDecision>;
  /** 待批阅/已批阅的紫宸殿奏折（Phase 4A：地方灾情等前朝事务）。 */
  memorials: Record<string, Memorial>;
  /** 国库流水台账（Phase 4B）：奏折批阅产生的原子借贷记录，append-only。 */
  treasuryLedger: TreasuryLedgerEntry[];
  /** 年度边情评估记录（Phase 4C）：append-only。 */
  frontierAssessments: FrontierAssessment[];
  memories: Record<string, CharacterMemoryStore>;
  /** 每名侍君（含皇后）的侍寝日志；非侍君无条目。 */
  bedchamber: Record<string, BedchamberRecord>;
  eventLog: EventLogEntry[];
  /** 客观事件编年史（append-only，剧情事实；与 eventLog 的触发记账分离）。 */
  chronicle: CourtEvent[];
  /** 角色持续状态（禁足等）。单一权威时间线，活跃判定见 characters/confinement.ts。 */
  statusEffects: CharacterStatusEffect[];
  /** 角色情绪状态（与永久创伤记忆分离；PR2c 只存储，自动恢复留待后续）。 */
  emotionalConditions: EmotionalCondition[];
  /** 记忆提及日志（PR4：冷却惩罚）。 */
  mentionLog: MemoryMentionRecord[];
  /** 事件反应日志（T2：去重 + 冷却；同一 speakerId/audienceId/eventId 三元组只反应一次）。 */
  eventReactionLog: EventReactionRecord[];
  sceneHistory: string[];
  /** 本晨被免请安的侍君（按 dayIndex 自然失效）。 */
  excusedFromGreeting?: { dayIndex: number; charIds: string[] };
  /** 子时留宿记录，供次晨离宫二选一。 */
  overnightWith?: { charId: string; morningDayIndex: number };
  /** 持久化身后事队列（皇帝不入队）。 */
  pendingAftermath: PendingAftermath[];
  /** 月度冷宫事件通报队列（PUNISH-4C）。append-only；acknowledged=true 表已呈报。 */
  coldPalaceIncidents: ColdPalaceIncident[];
  /** 玩家主动干预记录（PUNISH-4E）。append-only；每位居民每月至多一条。 */
  coldPalaceInterventions: ColdPalaceIntervention[];
  /**
   * 持久化「待消费的大选日历事件」：到点（catch-up）由时间事务统一入口探测置位，
   * 与具体行动路径无关；UI 消费后清空。announce 优先于 dianxuan。
   */
  pendingDaxuan?: PendingDaxuan;
  /** 终局：皇帝崩逝由时间事务在同批写入；置位后 title「继续」禁用（Task 5/8）。 */
  gameOver?: { cause: "sovereign_death"; at: GameTime };
  /** 后宫主理权运行态（六宫主理）。皇后正常时为 empress；禁足期间由侍君/内务府代理。 */
  haremAdministration: HaremAdministrationState;
  /** 六宫年度例核记录（每年最多一条；同时作为幂等标记与未读禀报队列）。 */
  haremAdminReviews: HaremAdminReviewRecord[];
  /** 宫斗阴谋持久化队列（Phase 5A-2）。append-only；status 原地更新。 */
  haremSchemes: HaremScheme[];
  /** 宫斗结果事件记录（Phase 5A-2）。append-only。 */
  haremIncidents: HaremIncident[];
  /**
   * 宫斗情报报告（Phase 5A-3a）。
   * unread 状态构成全局中断；玩家知识层，不含 actorId 真相。
   */
  haremIntrigueReports: HaremIntrigueReport[];
  /**
   * 已完成宫斗月度结算的期号集合（格式 "harem_intrigue_settlement:{year}:{MM}"）。
   * 无阴谋月份也需写入，避免重复规划。
   */
  settledHaremIntriguePeriods: string[];
  /** 后宫内部惩戒事件（PUNISH-4G-B）：append-only；pending_response 构成全局中断。 */
  haremDisciplineIncidents: HaremDisciplineIncident[];
  /** 司法记录持久层（PUNISH-3B1）。 */
  justice: JusticeState;
  /** 已完成季度财政结算的期号集合（格式 "quarterly_settlement:${year}:${month}"）。独立幂等键，与奏折存在无关。 */
  settledQuarterlyPeriods: string[];
  /** 对话历史日志（上限 NARRATIVE_LOG_MAX，溢出时从头删除）。*/
  narrativeLog?: NarrativeEntry[];
  rngSeed: number;
}

/** 待消费的大选日历事件（二月报告 / 四月殿选）。year=对应大选年。 */
export interface PendingDaxuan {
  kind: "announce" | "dianxuan";
  year: number;
}
