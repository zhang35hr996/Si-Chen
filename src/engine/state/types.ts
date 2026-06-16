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

export type PregnancyStatus = "none" | "pending" | "expecting";

export interface PregnancyState {
  /** none=未受孕; pending=已受孕未告知（玩家不可见）; expecting=怀胎 */
  status: PregnancyStatus;
  conceivedAt?: GameTime;
  /** 玩家选定的生父候选（1–3），confirm 后写入 */
  fatherIds: string[];
}

export interface BloodlineState {
  /** 宗嗣合法性 */
  legitimacy: number;
  /** 经血状态 */
  menstrualStatus: MenstrualStatus;
  /** 经血祭仪 scaffold */
  lastRiteAt?: GameTime;
  /** 帝王孕育状态（本期只到「怀胎」） */
  pregnancy: PregnancyState;
  /** Reserved (DESIGN §3.8) — always [] in the skeleton. */
  heirs: unknown[];
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

export interface CharacterStanding {
  /** Rank id from world.json's 位分 table (PR 3). */
  rank: string;
  /** 0–100 — 恩宠 (consort) / 圣眷 (official). */
  favor: number;
  /** 封号 (optional). When set, 称呼 becomes 封号+位分 (rank/title system). */
  title?: string;
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

export type BedchamberMode = "passion" | "pleasure";

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
