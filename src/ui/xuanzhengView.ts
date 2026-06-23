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

/**
 * 资源结果**公开白名单**（明面属性）：键 → { 标签, 极性 }。
 *  - 极性 +1：值越高越好（gain 着色为正向）；
 *  - 极性  0：中性（如外戚权势，升降取向暧昧，不做正负着色）。
 * **暗属性绝不入表**（cruelty/fatigue/regimeSecurity/ministerLoyalty/corruption/clanDiscontent/rumor）：
 * 引擎快照仍记录全量，但结果页只展示白名单内的公开指标，杜绝泄露后台属性（评审 PR4 阻塞）。
 */
const PUBLIC_RESOURCES: Record<string, { label: string; polarity: 1 | 0 }> = {
  "sovereign.health": { label: "健康", polarity: 1 },
  "sovereign.diligence": { label: "勤政", polarity: 1 },
  "sovereign.prestige": { label: "威望", polarity: 1 },
  "sovereign.martial": { label: "武力", polarity: 1 },
  "sovereign.statecraft": { label: "政略", polarity: 1 },
  "nation.military": { label: "军力", polarity: 1 },
  "nation.treasury": { label: "国库", polarity: 1 },
  "nation.publicSupport": { label: "民心", polarity: 1 },
  "nation.productivity": { label: "生产力", polarity: 1 },
  "nation.governance": { label: "朝政", polarity: 1 },
  "nation.consortClanPower": { label: "外戚权势", polarity: 0 }, // 中性：不据 delta 正负着色
};

export interface CourtSummaryRow {
  /** 稳定 React key：资源行用原始资源键，人物行用 charId（不用展示名，重名不冲突）。 */
  id: string;
  label: string;
  delta: number;
  /** +1=越高越好；0=中性（不正负着色）。 */
  polarity: 1 | 0;
}
export interface CourtSummaryView {
  resources: CourtSummaryRow[];
  attitudes: CourtSummaryRow[];
  empty: boolean;
}

/**
 * 真实 diff → 朝议结果显示模型。
 *  - 资源：仅公开白名单内的键参与展示（暗属性丢弃）；标签/极性查表，行 id = 资源键。
 *  - 态度：用人物显示名，行 id = charId；favor 越高越好（极性 +1）。
 * 着色由极性决定（见组件），不再只按 delta 正负——避免「越低越好」类指标被误标为正向。
 */
export function buildCourtSummary(db: ContentDB, diff: CourtMetricsDiff): CourtSummaryView {
  const resources: CourtSummaryRow[] = diff.resourceDeltas
    .filter((d) => d.key in PUBLIC_RESOURCES)
    .map((d) => ({ id: d.key, label: PUBLIC_RESOURCES[d.key]!.label, delta: d.delta, polarity: PUBLIC_RESOURCES[d.key]!.polarity }));
  const attitudes: CourtSummaryRow[] = diff.attitudeDeltas.map((d) => ({
    id: d.char,
    label: db.characters[d.char]?.profile.name ?? d.char,
    delta: d.delta,
    polarity: 1,
  }));
  return { resources, attitudes, empty: resources.length === 0 && attitudes.length === 0 };
}
