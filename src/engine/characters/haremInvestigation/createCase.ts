/**
 * 立案领域函数（Phase 5B-1A）。
 * 纯函数：接收 GameState，返回带有新 case 和更新后 report 的 GameState。
 * 知识边界：初始知识完全复制自 HaremIntrigueReport，不读取 haremSchemes/haremIncidents。
 */
import { ok, err, type Result } from "../../infra/result";
import { stateError, type GameError } from "../../infra/errors";
import type { GameState } from "../../state/types";
import type { GameTime } from "../../calendar/time";
import type { IntrigueInvestigationCase, InvestigatableReportKind } from "./types";

/** 不可立案的 report 种类（调查进行中的中间报告）。 */
const NON_INVESTIGATABLE_KINDS = new Set(["investigation_update", "investigation_final"]);

export function createIntrigueInvestigationCase(
  state: GameState,
  reportId: string,
  at: GameTime,
): Result<{ state: GameState; caseId: string }, GameError[]> {
  const report = state.haremIntrigueReports.find((r) => r.id === reportId);
  if (!report) {
    return err([stateError("INTRIGUE_REPORT_NOT_FOUND", `haremIntrigueReports: report "${reportId}" not found`)]);
  }

  if (report.status === "archived") {
    return err([stateError("INTRIGUE_REPORT_NOT_INVESTIGATABLE", `report "${reportId}" status=archived cannot be investigated`)]);
  }

  if (NON_INVESTIGATABLE_KINDS.has(report.reportKind)) {
    return err([stateError("INTRIGUE_REPORT_NOT_INVESTIGATABLE", `report "${reportId}" reportKind="${report.reportKind}" cannot be investigated`)]);
  }

  // 幂等：同一 report 已链接到现有案件 → 返回已有 caseId
  if (report.linkedInvestigationId) {
    const existing = state.haremInvestigationCases.find((c) => c.id === report.linkedInvestigationId);
    if (existing) {
      return ok({ state, caseId: existing.id });
    }
    // linkedInvestigationId 指向不存在案件 → 存档损坏
    return err([stateError("INTRIGUE_CASE_CREATE_FAILED", `report "${reportId}" linkedInvestigationId="${report.linkedInvestigationId}" points to non-existent case`)]);
  }

  const caseId = `icase_${reportId}`;

  // 防止重复 ID（理论上不应出现，防御性检查）
  if (state.haremInvestigationCases.some((c) => c.id === caseId)) {
    return err([stateError("INTRIGUE_CASE_DUPLICATE_ID", `haremInvestigationCases: case id="${caseId}" already exists`)]);
  }

  // unread report 立案时视为已读
  const acknowledgedAt = report.acknowledgedAt ?? at;

  const newCase: IntrigueInvestigationCase = {
    id: caseId,
    source: {
      reportId: report.id,
      incidentId: report.source.incidentId,
    },
    openedAt: at,
    openedFromReportKind: report.reportKind as InvestigatableReportKind,
    // exposure/confirmed 报告立案时直接进入 ready_for_review（H1 修复）
    status: report.confidence === "confirmed" ? "ready_for_review" : "open",
    knownTargetIds: [...report.knownTargetIds],
    suspectIds: [...report.suspectedActorIds],
    suspectedKinds: [...report.suspectedKinds],
    confidence: report.confidence,
    leadIds: [],
  };

  const updatedReports = state.haremIntrigueReports.map((r) =>
    r.id === reportId
      ? {
          ...r,
          status: "actioned" as const,
          action: "investigating" as const,
          acknowledgedAt,
          linkedInvestigationId: caseId,
        }
      : r,
  );

  return ok({
    state: {
      ...state,
      haremIntrigueReports: updatedReports,
      haremInvestigationCases: [...state.haremInvestigationCases, newCase],
    },
    caseId,
  });
}

export function cancelIntrigueInvestigationCase(
  state: GameState,
  caseId: string,
  at: GameTime,
): Result<GameState, GameError[]> {
  const idx = state.haremInvestigationCases.findIndex((c) => c.id === caseId);
  if (idx === -1) {
    return err([stateError("INTRIGUE_CASE_CREATE_FAILED", `haremInvestigationCases: case "${caseId}" not found`)]);
  }
  const c = state.haremInvestigationCases[idx]!;
  if (c.status !== "open" && c.status !== "in_progress" && c.status !== "ready_for_review") {
    return err([stateError("INTRIGUE_CASE_CREATE_FAILED", `case "${caseId}" status="${c.status}" cannot be cancelled`)]);
  }
  const updated = [...state.haremInvestigationCases];
  updated[idx] = { ...c, status: "cancelled", closedAt: at, closureReason: "player_cancelled" };

  // 原子取消该案件所有 pending 任务，防止 settlement 继续生成线索（B2 修复）
  const cancelledTasks = Object.fromEntries(
    Object.entries(state.haremInvestigationTasks).map(([id, task]) =>
      task.caseId === caseId && task.status === "pending"
        ? [id, { ...task, status: "cancelled" as const }]
        : [id, task],
    ),
  );
  return ok({ ...state, haremInvestigationCases: updated, haremInvestigationTasks: cancelledTasks });
}
