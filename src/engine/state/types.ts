/**
 * GameState shape (skeleton-plan §4). Plain TS types in PR 2; PR 3 introduces
 * the Zod schemas as the runtime-validation source and these types align with
 * z.infer there. Resource pillars are scaffold-only (§2 guard): initialized,
 * mutated by effects, shown in debug, persisted — never read by logic.
 */
import type { CalendarState, GameTime } from "../calendar/time";
import type { CharacterContent } from "../content/schemas";

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
  /** 任职时刻（可空；开局官员置开局时刻）。 */
  appointedAt?: GameTime;
  /** 最近一次状态变化时刻（非 active 时应有）。 */
  statusChangedAt?: GameTime;
  /** 最近一次状态变化原因（非 active 时应有；active 时不设）。 */
  statusReason?: OfficialStatusReason;
  /** 死亡时刻（status=dead 时应有）。 */
  deathAt?: GameTime;
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

export interface CharacterStanding {
  /** Rank id from world.json's 位分 table. */
  rank: string;
  /** 0–100 — 恩宠 (consort) / 圣眷 (official). */
  favor: number;
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

// ── 角色持续状态（可复用：禁足 / 后续冷宫·下狱·守丧·卧病）─────────────────
// 单一权威的「持续效果」时间线：append-mostly，解除时就地标记 lifted 而非物理删除，
// 以保留历史。活跃判定只依据 startTurn/endTurnExclusive/liftedTurn，不存「剩余月份」。
export type StatusEffectKind = "confinement";

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
}

/** 角色持续状态的判别联合（目前仅禁足；冷宫/下狱/守丧待扩展）。 */
export type CharacterStatusEffect = ConfinementEffect;

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
  | "harem_administration_changed";
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
}

/**
 * 后宫主理权变动原因。
 *   empress_confined      — 凤后被禁足，交由侍君或内务府代理。
 *   empress_illness       — 凤后抱恙（sick/critical），暂交代理（行政性，非处罚）。
 *   imperial_deprivation  — 凤后健康，皇帝主动收回主理权（处罚性）。
 *   no_eligible_consort   — 无合格候选侍君，转内务府代理（常与上述原因共存）。
 *   imperial_reassignment — 已有代理时，皇帝改派另一代理者（行政性重新委任）。
 */
export type HaremAdministrationReason =
  | "empress_confined"
  | "empress_illness"
  | "imperial_deprivation"
  | "no_eligible_consort"
  | "imperial_reassignment";

/**
 * 后宫主理权运行态。
 *   empress        — 凤后正常掌宫（默认）。
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
  /**
   * 持久化「待消费的大选日历事件」：到点（catch-up）由时间事务统一入口探测置位，
   * 与具体行动路径无关；UI 消费后清空。announce 优先于 dianxuan。
   */
  pendingDaxuan?: PendingDaxuan;
  /** 终局：皇帝崩逝由时间事务在同批写入；置位后 title「继续」禁用（Task 5/8）。 */
  gameOver?: { cause: "sovereign_death"; at: GameTime };
  /** 后宫主理权运行态（六宫主理）。凤后正常时为 empress；禁足期间由侍君/内务府代理。 */
  haremAdministration: HaremAdministrationState;
  rngSeed: number;
}

/** 待消费的大选日历事件（二月报告 / 四月殿选）。year=对应大选年。 */
export interface PendingDaxuan {
  kind: "announce" | "dianxuan";
  year: number;
}
