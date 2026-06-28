/**
 * 线索知识更新（Phase 5B-2）。
 * applyInvestigationLead 负责将线索结果合并进案件玩家知识层。
 * 知识边界：所有更新均来自 IntrigueInvestigationLead，不读取 haremIncidents 真相。
 */
import type { GameState } from "../../state/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";
import type { IntrigueInvestigationLead } from "./types";
import { leadStrengthToConfidence } from "./types";

const CONFIDENCE_ORDER: HaremIntrigueReportConfidence[] = [
  "tenuous",
  "plausible",
  "strong",
  "confirmed",
];

function maxConfidence(
  a: HaremIntrigueReportConfidence,
  b: HaremIntrigueReportConfidence,
): HaremIntrigueReportConfidence {
  const ia = CONFIDENCE_ORDER.indexOf(a);
  const ib = CONFIDENCE_ORDER.indexOf(b);
  return ia >= ib ? a : b;
}

/** 把线索结论合并进案件的玩家知识层，返回更新后的 GameState。 */
export function applyInvestigationLead(
  state: GameState,
  lead: IntrigueInvestigationLead,
): GameState {
  const idx = state.haremInvestigationCases.findIndex((c) => c.id === lead.caseId);
  if (idx === -1) return state;

  const c = state.haremInvestigationCases[idx]!;

  // 合并 implicatedIds → suspectIds（去重）
  const newSuspects = new Set(c.suspectIds);
  for (const id of lead.implicatedIds) newSuspects.add(id);

  // 移除 clearedIds（从 suspectIds）
  for (const id of lead.clearedIds) newSuspects.delete(id);

  // 合并 revealedKinds（去重）
  const newKinds = new Set(c.suspectedKinds);
  for (const k of lead.revealedKinds) newKinds.add(k);

  // 线索 ID 追加
  const newLeadIds = c.leadIds.includes(lead.id) ? c.leadIds : [...c.leadIds, lead.id];

  // 置信度：取当前与线索强度的最大值
  const newConfidence = maxConfidence(c.confidence, leadStrengthToConfidence(lead.strength));

  // 状态升级：合并后置信度达到 strong/confirmed → ready_for_review（H1 修复：依据 newConfidence 而非 lead.strength）
  const nextStatus =
    (newConfidence === "strong" || newConfidence === "confirmed") &&
    (c.status === "in_progress" || c.status === "open")
      ? "ready_for_review"
      : c.status;

  const updated = {
    ...c,
    suspectIds: [...newSuspects],
    suspectedKinds: [...newKinds],
    leadIds: newLeadIds,
    confidence: newConfidence,
    status: nextStatus,
  } as typeof c;

  const cases = [...state.haremInvestigationCases];
  cases[idx] = updated;

  return { ...state, haremInvestigationCases: cases };
}
