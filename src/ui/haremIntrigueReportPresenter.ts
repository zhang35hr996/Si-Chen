/**
 * 宫斗情报报告展示层（Phase 5A-3b）。
 * 纯函数：只读取 HaremIntrigueReport 公开字段，不得访问 haremSchemes / haremIncidents.actorId。
 *
 * 分路依据：
 *  - exposure：按 reportKind === "exposure" 分路，body 由 actor/target/outcome 组合；不依赖 summaryCode
 *  - anomaly ：summaryCode 决定措辞变体（目前只有 "anomaly_unexplained_harm"），fallback 兜底
 *
 * 知识边界：anomaly 路径不暴露 actorLabel、真实 kind 或 scheme 细节。
 */
import type { HaremIntrigueReport } from "../engine/state/types";
import type { HaremIntrigueKind } from "../engine/characters/haremIntrigue/types";

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

/** 玩家可知的阴谋手段标签（只在 exposure 报告中展示）。 */
const KIND_LABELS: Record<HaremIntrigueKind, string> = {
  slander: "散布谣言",
  false_accusation: "诬告陷害",
  steal_credit: "窃取功劳",
  faction_pressure: "结党施压",
  servant_subversion: "收买仆从",
};

function timeLabelOf(report: HaremIntrigueReport): string {
  const { year, month, period } = report.createdAt;
  const yearStr = year === 1 ? "元年" : `${year}年`;
  return `${yearStr}${month}月${PERIOD_LABELS[period] ?? ""}`;
}

function exposureBody(
  actorLabel: string,
  targetLabel: string,
  kindLabel: string,
  outcomeLabel: string,
): string[] {
  const succeeded = outcomeLabel === "已得逞";
  return [
    `经查，${actorLabel}曾暗中以「${kindLabel}」手段对${targetLabel}施压。`,
    succeeded
      ? "此举已伤及当事人，宫中已有人知晓。"
      : "所幸此举未能完全得逞，宫中已有人知晓。",
  ];
}

function anomalyBody(summaryCode: string, targetLabel: string): string[] {
  switch (summaryCode) {
    case "anomaly_unexplained_harm":
      return [
        `近日${targetLabel}处似有异常。`,
        "其处境无故受损，暂未查明是何人所为。",
      ];
    default:
      return ["宫中近日似有异常，详情尚未查明。"];
  }
}

const INVESTIGATION_UPDATE_SUMMARY_CODES: Record<string, string[]> = {
  inquiry_limited_findings: [
    "奉命查办之事已有回报。",
    "经暗中查访，宫人所述含糊，尚无足以定论之证据。",
  ],
  inquiry_found_suspicious_pattern: [
    "奉命查办之事已有回报。",
    "经暗中查访，已发现若干可疑之处，仍需进一步核实。",
  ],
  suspect_inconclusive_account: [
    "奉命查办之事已有回报。",
    "经问询当事人，所述前后不一，尚不足以定论。",
  ],
  suspect_contradicted_account: [
    "奉命查办之事已有回报。",
    "经审问，当事人供词与已知证据存在明显出入，嫌疑加深。",
  ],
  target_account_consistent: [
    "奉命查办之事已有回报。",
    "经问询，受害之人所述有所提供，调查仍在继续。",
  ],
};

function investigationUpdateBody(summaryCode: string): string[] {
  return (
    INVESTIGATION_UPDATE_SUMMARY_CODES[summaryCode] ?? [
      "奉命查办之事已有回报。",
      "经查，宫人供述中出现前后不一之处，现有线索仍不足以定论。",
    ]
  );
}

function investigationFinalBody(summaryCode: string, confidence: string): string[] {
  const confLabel =
    confidence === "confirmed"
      ? "已有确证"
      : confidence === "strong"
        ? "线索较为明确"
        : "已有一定眉目";
  return [
    "此案调查已有较为明确的结果。",
    `目前${confLabel}，相关卷宗已呈入紫宸殿，待圣上裁定。`,
    ...(summaryCode === "suspect_contradicted_account"
      ? ["嫌疑人供词与证据出入较大，可信度存疑。"]
      : []),
  ];
}

export function presentHaremIntrigueReport(
  report: HaremIntrigueReport,
  resolveCharacterName: (id: string) => string,
): HaremIntrigueReportPresentation {
  const targetLabels = report.knownTargetIds.map(resolveCharacterName);
  const targetLabel = targetLabels[0] ?? "某侍君";
  const outcome = OUTCOME_LABELS[report.knownOutcome] ?? "结果不明";
  const confidence = CONFIDENCE_LABELS[report.confidence] ?? report.confidence;

  if (report.reportKind === "investigation_final") {
    return {
      title: "调查结果上报",
      body: investigationFinalBody(report.summaryCode, report.confidence),
      actorLabel: undefined,
      targetLabels,
      outcomeLabel: outcome,
      confidenceLabel: confidence,
      timeLabel: timeLabelOf(report),
    };
  }

  if (report.reportKind === "investigation_update") {
    return {
      title: "调查已有进展",
      body: investigationUpdateBody(report.summaryCode),
      actorLabel: undefined,
      targetLabels,
      outcomeLabel: outcome,
      confidenceLabel: confidence,
      timeLabel: timeLabelOf(report),
    };
  }

  if (report.reportKind === "exposure") {
    const actorId = report.suspectedActorIds[0];
    const actorLabel = actorId ? resolveCharacterName(actorId) : "不明人士";
    const kind = report.suspectedKinds[0];
    const kindLabel = kind ? (KIND_LABELS[kind] ?? kind) : "不明手段";
    return {
      title: "宫中来报",
      body: exposureBody(actorLabel, targetLabel, kindLabel, outcome),
      actorLabel,
      targetLabels,
      outcomeLabel: outcome,
      confidenceLabel: confidence,
      timeLabel: timeLabelOf(report),
    };
  }

  // anomaly — 不暴露 actor/kind
  return {
    title: "宫中异动",
    body: anomalyBody(report.summaryCode, targetLabel),
    actorLabel: undefined,
    targetLabels,
    outcomeLabel: outcome,
    confidenceLabel: confidence,
    timeLabel: timeLabelOf(report),
  };
}

/** 历史列表摘要行（一行文字）。 */
export function intrigueReportSummaryLine(
  report: HaremIntrigueReport,
  resolveCharacterName: (id: string) => string,
): string {
  const time = timeLabelOf(report);
  const target = report.knownTargetIds.map(resolveCharacterName).join("、") || "某侍君";
  if (report.reportKind === "investigation_final") {
    return `${time}　关于${target}一案调查已有结果，待裁定`;
  }
  if (report.reportKind === "investigation_update") {
    return `${time}　关于${target}一案调查已有进展`;
  }
  if (report.reportKind === "exposure") {
    const actorId = report.suspectedActorIds[0];
    const actor = actorId ? resolveCharacterName(actorId) : "不明人士";
    return `${time}　${actor}对${target}之事败露`;
  }
  return `${time}　${target}处出现不明异动`;
}
