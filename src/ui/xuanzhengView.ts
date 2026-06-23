/**
 * 宣政殿 App 接线的纯决策层（scene-ui-narrative-refactor PR4 Task 4.2）。
 * 仓库惯例：App 依赖的判断抽成纯函数单测，组件只装配。
 *  - courtHoldGate：升朝门槛（健康/服丧 + 卯时满行动力），真实原因，不另造规则。
 *  - buildCourtSummary：把引擎 diffCourtMetrics 的真实差值映射为显示模型（资源中文标签 + 官员/侍君名）。
 *    无变化绝不臆造行；diff 计算只在引擎层，组件不散落。
 */
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import type { CourtMetricsDiff } from "../engine/court/agenda";
import { canHoldCourt } from "../store/gating";

export type CourtHoldGate = { ok: true } | { ok: false; reason: string };

/** 升朝门槛：先看健康/服丧（canHoldCourt），再看卯时满行动力（beginCourt 的硬约束）。 */
export function courtHoldGate(state: GameState): CourtHoldGate {
  const base = canHoldCourt(state);
  if (!base.ok) return base;
  if (state.calendar.ap !== state.calendar.apMax) {
    return { ok: false, reason: "升朝须于卯时首理政务（行动力未满）。" };
  }
  return { ok: true };
}

/** 资源命名空间键 → 中文标签（来自 SovereignState / NationState 字段语义）。 */
const RESOURCE_LABELS: Record<string, string> = {
  "sovereign.health": "健康",
  "sovereign.diligence": "勤政",
  "sovereign.prestige": "威望",
  "sovereign.martial": "武力",
  "sovereign.statecraft": "政略",
  "sovereign.cruelty": "暴戾",
  "sovereign.fatigue": "疲劳",
  "sovereign.regimeSecurity": "皇权安全",
  "nation.military": "军力",
  "nation.treasury": "国库",
  "nation.publicSupport": "民心",
  "nation.productivity": "生产力",
  "nation.governance": "朝政",
  "nation.consortClanPower": "外戚权势",
  "nation.ministerLoyalty": "大臣忠心",
  "nation.corruption": "贪腐",
  "nation.clanDiscontent": "宗室不满",
  "nation.rumor": "谣言",
};

export interface CourtSummaryRow {
  label: string;
  delta: number;
}
export interface CourtSummaryView {
  resources: CourtSummaryRow[];
  attitudes: CourtSummaryRow[];
  empty: boolean;
}

/** 真实 diff → 朝议结果显示模型。资源标签查表（未知键回退原键）；态度用人物显示名。 */
export function buildCourtSummary(db: ContentDB, diff: CourtMetricsDiff): CourtSummaryView {
  const resources: CourtSummaryRow[] = diff.resourceDeltas.map((d) => ({
    label: RESOURCE_LABELS[d.key] ?? d.key,
    delta: d.delta,
  }));
  const attitudes: CourtSummaryRow[] = diff.attitudeDeltas.map((d) => ({
    label: db.characters[d.char]?.profile.name ?? d.char,
    delta: d.delta,
  }));
  return { resources, attitudes, empty: resources.length === 0 && attitudes.length === 0 };
}
