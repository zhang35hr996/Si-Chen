/**
 * GameState shape (skeleton-plan §4). Plain TS types in PR 2; PR 3 introduces
 * the Zod schemas as the runtime-validation source and these types align with
 * z.infer there. Resource pillars are scaffold-only (§2 guard): initialized,
 * mutated by effects, shown in debug, persisted — never read by logic.
 */
import type { CalendarState, GameTime } from "../calendar/time";

// ── Global resource pillars (scaffold values 0–100) ──────────────────
export interface CourtState {
  /** 圣威 */
  authority: number;
  /** 民心 */
  publicSupport: number;
  /** 派系压力 */
  factionPressure: number;
}

export interface HaremState {
  /** 和睦 */
  harmony: number;
  /** 妒意 */
  jealousy: number;
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
}

export interface BloodlineState {
  /** 宗嗣合法性 */
  legitimacy: number;
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

export interface Resources {
  court: CourtState;
  harem: HaremState;
  bloodline: BloodlineState;
}

// ── Per-character runtime state ───────────────────────────────────────
export interface RelationshipState {
  /** 信任 0–100 */
  trust: number;
  /** 亲和 0–100 — 爱慕 for consorts, 亲附/敬慕 for officials */
  affinity: number;
  flags: string[];
}

export type ConsortLifecycle = "normal" | "candidate" | "carrying" | "delivered" | "deceased";

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

// ── The single authoritative state ────────────────────────────────────
export type FlagValue = boolean | number | string;

export interface EventLogEntry {
  eventId: string;
  firedAt: GameTime;
}

export interface GameState {
  calendar: CalendarState;
  playerLocation: string;
  resources: Resources;
  flags: Record<string, FlagValue>;
  relationships: Record<string, RelationshipState>;
  standing: Record<string, CharacterStanding>;
  memories: Record<string, CharacterMemoryStore>;
  /** 每名侍君（含皇后）的侍寝日志；非侍君无条目。 */
  bedchamber: Record<string, BedchamberRecord>;
  eventLog: EventLogEntry[];
  sceneHistory: string[];
  rngSeed: number;
}
