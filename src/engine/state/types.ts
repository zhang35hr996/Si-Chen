/**
 * GameState shape (skeleton-plan §4). Plain TS types in PR 2; PR 3 introduces
 * the Zod schemas as the runtime-validation source and these types align with
 * z.infer there. Resource pillars are scaffold-only (§2 guard): initialized,
 * mutated by effects, shown in debug, persisted — never read by logic.
 */
import type { CalendarState, GameTime } from "../calendar/time";

// ── Global resource pillars (scaffold values 0–100) ──────────────────
// 皇帝(玩家本人)属性。明面: health/diligence/prestige/martial/statecraft；
// 暗属性: cruelty/fatigue/regimeSecurity。年龄/生日在 calendar，非此处。见
// docs/systems/21-attribute-catalog.md。
export interface SovereignState {
  /** 健康 */
  health: number;
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

/** 朝臣名册条目（轻量运行态）。权势不落字段——由 postId→品级 派生。 */
export interface Official {
  id: string;
  surname: string;
  givenName: string;
  postId: string;
  loyalty: number; // 忠心 0–100
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
  /** 所居宫室（缺省 "main" 主殿）。 */
  chamber?: ChamberId;
  /** 凤体违和（病）。 */
  ill?: boolean;
  /** 禁足。 */
  confined?: boolean;
  /** 好感/情意 0–100（仅侍君；缺省回退 authored hidden.affection）。 */
  affection?: number;
}

// ── Memory v0 (writes land in PR 9; the shape is part of GameState now) ─
export type MemoryKind = "event" | "fact_learned" | "opinion" | "promise" | "conversation_summary";

export interface MemoryEntry {
  /** "mem_<charId>_000001" — monotonic per character. */
  id: string;
  kind: MemoryKind;
  /** ≤240 chars, third person, this character's POV. */
  summary: string;
  /** 0–100 */
  salience: number;
  createdAt: GameTime;
  /** ≤5, lowercased. */
  tags: string[];
  /** Character ids incl. "player". */
  participants: string[];
  locationId?: string;
  source: "authored" | "scene_outcome";
  /** Which scene's commit wrote this entry — the debug trace. Absent for authored seeds and non-scene batches. */
  originSceneId?: string;
  protected: boolean;
}

export interface CharacterMemoryStore {
  entries: MemoryEntry[];
  nextSeq: number;
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

// ── 太后（尊长）状态 ──────────────────────────────────────────────────
export interface TaihouState {
  /** 太后是否卧病。 */
  ill: boolean;
}

// ── The single authoritative state ────────────────────────────────────
export type FlagValue = boolean | number | string;

export interface EventLogEntry {
  eventId: string;
  firedAt: GameTime;
}

export interface GameState {
  calendar: CalendarState;
  playerLocation: string;
  taihou: TaihouState;
  resources: Resources;
  flags: Record<string, FlagValue>;
  standing: Record<string, CharacterStanding>;
  officials: Record<string, Official>;
  memories: Record<string, CharacterMemoryStore>;
  /** 每名侍君（含皇后）的侍寝日志；非侍君无条目。 */
  bedchamber: Record<string, BedchamberRecord>;
  eventLog: EventLogEntry[];
  sceneHistory: string[];
  rngSeed: number;
}
