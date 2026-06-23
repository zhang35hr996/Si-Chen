/**
 * 宣政殿朝议：议程预览 + 结算快照 diff（scene-ui-narrative-refactor §9 / PR4 Task 4.1）。
 *
 * 纯函数、零副作用：
 *  - courtAgendaPreview：与 beginCourt 同种子（court:{rngSeed}:{dayIndex}）取真实将抽事务标题，UI 不臆造。
 *  - snapshot/diff：朝议前后各抓一次权威 state 快照，按真实差值生成结果摘要（资源 + 官员/侍君态度），
 *    绝不在组件内散落 diff 计算、绝不伪造无变化的条目。不改 DialogueScreen.onDone 契约。
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import { pickCourtAffairs } from "./affairs";

export interface CourtAgendaItem {
  id: string;
  title: string;
}

/** 朝议议程预览：与 beginCourt 同种子的真实将抽事务（标题取自 content，缺省回退 id）。 */
export function courtAgendaPreview(db: ContentDB, state: GameState): CourtAgendaItem[] {
  const seed = `court:${state.rngSeed}:${state.calendar.dayIndex}`;
  return pickCourtAffairs(db, seed).map((id) => ({ id, title: db.events[id]?.title ?? id }));
}

export interface CourtMetrics {
  /** 命名空间键（"nation.treasury" / "sovereign.prestige"）→ 数值。 */
  resources: Record<string, number>;
  /** charId → favor（态度）。 */
  favor: Record<string, number>;
}

/** 扁平化对象中的数值字段（忽略字符串/对象/布尔），按 prefix 命名空间。 */
function flattenNumbers(prefix: string, obj: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number" && Number.isFinite(value)) out[`${prefix}.${key}`] = value;
  }
  return out;
}

/** 抓一次朝议相关权威指标快照（帝王/国家数值资源 + 各 standing.favor）。 */
export function snapshotCourtMetrics(state: GameState): CourtMetrics {
  const resources = {
    ...flattenNumbers("sovereign", state.resources.sovereign as unknown as Record<string, unknown>),
    ...flattenNumbers("nation", state.resources.nation as unknown as Record<string, unknown>),
  };
  const favor: Record<string, number> = {};
  for (const [charId, st] of Object.entries(state.standing)) {
    if (st && typeof st.favor === "number") favor[charId] = st.favor;
  }
  return { resources, favor };
}

export interface CourtMetricDelta {
  key: string;
  delta: number;
}
export interface CourtAttitudeDelta {
  char: string;
  delta: number;
}
export interface CourtMetricsDiff {
  resourceDeltas: CourtMetricDelta[];
  attitudeDeltas: CourtAttitudeDelta[];
}

/** 朝议前后真实差值（仅非零项；稳定按 key/char 升序）。纯函数，不改入参。 */
export function diffCourtMetrics(before: CourtMetrics, after: CourtMetrics): CourtMetricsDiff {
  const resourceDeltas: CourtMetricDelta[] = [];
  for (const key of Object.keys(after.resources)) {
    const delta = after.resources[key]! - (before.resources[key] ?? after.resources[key]!);
    if (delta !== 0) resourceDeltas.push({ key, delta });
  }
  resourceDeltas.sort((a, b) => a.key.localeCompare(b.key));

  const attitudeDeltas: CourtAttitudeDelta[] = [];
  for (const char of Object.keys(after.favor)) {
    const delta = after.favor[char]! - (before.favor[char] ?? after.favor[char]!);
    if (delta !== 0) attitudeDeltas.push({ char, delta });
  }
  attitudeDeltas.sort((a, b) => a.char.localeCompare(b.char));

  return { resourceDeltas, attitudeDeltas };
}
