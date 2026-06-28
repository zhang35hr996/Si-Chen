/**
 * 宫斗情报报告展示层（Phase 5A-3b）。
 * 纯函数：只读取 HaremIntrigueReport 公开字段，不得访问 haremSchemes / haremIncidents.actorId。
 */
import type { HaremIntrigueReport } from "../engine/state/types";

export interface HaremIntrigueReportPresentation {
  /** 弹窗标题 */
  title: string;
  /** 正文段落（每条为一行） */
  body: string[];
  /** 已知施害方标签（exposure 才有；anomaly 不显示） */
  actorLabel?: string;
  /** 受影响侍君显示名 */
  targetLabels: string[];
  /** 结果标签 */
  outcomeLabel: string;
  /** 可信度标签 */
  confidenceLabel: string;
  /** 时间标签（月旬简短格式） */
  timeLabel: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  harm_observed: "已得逞",
  attempt_observed: "未得逞",
  unknown: "结果不明",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  confirmed: "证据确凿",
  strong: "较为确定",
  plausible: "有所怀疑",
  tenuous: "尚待查证",
};

const PERIOD_LABELS: Record<string, string> = {
  early: "上旬",
  mid: "中旬",
  late: "下旬",
};

function timeLabel(report: HaremIntrigueReport): string {
  const { year, month, period } = report.createdAt;
  const yearStr = year === 1 ? "元年" : `${year}年`;
  return `${yearStr}${month}月${PERIOD_LABELS[period] ?? ""}`;
}

/** summaryCode → 正文文案。对未知 summaryCode 返回安全 fallback，不暴露后台 kind。 */
function summaryToBody(
  summaryCode: string,
  actorLabels: string[],
  targetLabels: string[],
  outcomeLabel: string,
): string[] {
  switch (summaryCode) {
    case "exposure": {
      const actor = actorLabels[0] ?? "不明人士";
      const target = targetLabels[0] ?? "某侍君";
      return [
        `经查，${actor}曾暗中对${target}施以阴谋手段。`,
        `此事${outcomeLabel === "已得逞" ? "已伤及当事人" : "虽未完全得逞"}，宫中已有人知晓。`,
      ];
    }
    case "anomaly_unexplained_harm": {
      const target = targetLabels[0] ?? "某侍君";
      return [
        `近日${target}处似有异常。`,
        "其处境无故受损，暂未查明是何人所为。",
      ];
    }
    default:
      return ["宫中近日似有异常，详情尚未查明。"];
  }
}

export function presentHaremIntrigueReport(
  report: HaremIntrigueReport,
  resolveCharacterName: (id: string) => string,
): HaremIntrigueReportPresentation {
  const targetLabels = report.knownTargetIds.map(resolveCharacterName);
  const actorLabel =
    report.reportKind === "exposure" && report.suspectedActorIds.length > 0
      ? resolveCharacterName(report.suspectedActorIds[0]!)
      : undefined;

  const outcome = OUTCOME_LABELS[report.knownOutcome] ?? "结果不明";
  const confidence = CONFIDENCE_LABELS[report.confidence] ?? report.confidence;

  const isExposure = report.reportKind === "exposure";

  return {
    title: isExposure ? "宫中来报" : "宫中异动",
    body: summaryToBody(
      report.summaryCode,
      actorLabel ? [actorLabel] : [],
      targetLabels,
      outcome,
    ),
    actorLabel,
    targetLabels,
    outcomeLabel: outcome,
    confidenceLabel: confidence,
    timeLabel: timeLabel(report),
  };
}

/** 历史列表摘要行（一行文字）。 */
export function intrigueReportSummaryLine(
  report: HaremIntrigueReport,
  resolveCharacterName: (id: string) => string,
): string {
  const time = timeLabel(report);
  const target = report.knownTargetIds.map(resolveCharacterName).join("、") || "某侍君";
  if (report.reportKind === "exposure") {
    const actor = report.suspectedActorIds[0]
      ? resolveCharacterName(report.suspectedActorIds[0])
      : "不明人士";
    return `${time}　${actor}对${target}之事败露`;
  }
  return `${time}　${target}处出现不明异动`;
}
