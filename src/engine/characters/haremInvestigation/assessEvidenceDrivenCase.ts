/**
 * 证据驱动案件评估（Phase 5B-2B2b）。
 *
 * 纯函数：只读取案件「已发现」证据的 claims / strength / sourceEvidenceNodeId，
 * 用 sourceEvidenceNodeId 做独立性去重（同节点多 lead 算同一证据来源）。
 *
 * 知识边界：
 *  - 允许读取 lead.claims / lead.strength / lead.sourceEvidenceNodeId（脱敏结论）。
 *  - 严禁读取 InvestigationTruth / node.misleading / truth.culpritIds / truth.causeType。
 *
 * 返回 EvidenceCaseAssessment（平坦接口），供 settlement 决定案件是否进入
 * ready_for_review、供 review 校验玩家裁定。
 */
import type { GameState } from "../../state/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";
import type { InvestigationLeadStrength } from "./types";

/** 非人为加害且可通过证据确认的病因类型。 */
export type ConfirmableCause = "natural_illness" | "negligence" | "accident";

const CONFIRMABLE_CAUSES: readonly ConfirmableCause[] = ["natural_illness", "negligence", "accident"];

export interface EvidenceCaseAssessment {
  confidence: HaremIntrigueReportConfidence;
  /** 可被确认为主谋的人物 ID（已排序）；空 = 尚不足以认定任何人。 */
  confirmableCulpritIds: string[];
  /** 可被确认的非人为病因类型；空 = 尚无充分病因证据。 */
  confirmableCauseTypes: ConfirmableCause[];
  /** 是否具备至少一种合法裁定出口（确认主谋或确认病因）。 */
  readyForReview: boolean;
}

const STRENGTH_ORDER: InvestigationLeadStrength[] = ["tenuous", "plausible", "strong", "confirmed"];
function maxStrength(a: InvestigationLeadStrength, b: InvestigationLeadStrength): InvestigationLeadStrength {
  return STRENGTH_ORDER.indexOf(a) >= STRENGTH_ORDER.indexOf(b) ? a : b;
}

/** 单个已发现证据节点的脱敏视图（来自一条 Lead）。 */
interface DiscoveredEvidence {
  nodeId: string;
  claims: NonNullable<GameState["haremInvestigationLeads"][string]["claims"]>;
}

/**
 * 收集案件「已发现」的证据节点（去重：同 nodeId 只取一次）。
 * 只读取 lead 公开字段，绝不访问 InvestigationTruth 或 node.misleading。
 */
function collectDiscoveredEvidence(state: GameState, caseId: string): DiscoveredEvidence[] {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c || c.source.kind !== "investigation_incident") return [];

  const seen = new Set<string>();
  const out: DiscoveredEvidence[] = [];
  for (const lid of c.leadIds) {
    const lead = state.haremInvestigationLeads[lid];
    if (!lead || !lead.sourceEvidenceNodeId || !lead.claims) continue;
    if (seen.has(lead.sourceEvidenceNodeId)) continue;
    seen.add(lead.sourceEvidenceNodeId);
    out.push({ nodeId: lead.sourceEvidenceNodeId, claims: lead.claims });
  }
  return out;
}

function caseConfidence(state: GameState, caseId: string): HaremIntrigueReportConfidence {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c) return "tenuous";

  // 基线取来源立案报告（anomaly）的置信度：立案时已公开存在的合理嫌疑（如已有公开
  // 被指控者）不应被某次「未查到新证据」抹去。再与各线索强度取最大值。
  // 不读 c.confidence——它可能是上一轮 assessment 写入的派生 confirmed；玩家选择
  // 继续调查后若证据回落，置信度应能跟随实际证据强度下降，而非被旧派生值锁定。
  let best: InvestigationLeadStrength = "tenuous";
  if (c.source.kind === "investigation_incident") {
    const sourceReport = (state.investigationPublicReports ?? []).find(
      (r) => r.id === c.source.reportId && r.reportKind === "anomaly",
    );
    if (sourceReport) best = sourceReport.confidence as InvestigationLeadStrength;
  }
  for (const lid of c.leadIds) {
    const lead = state.haremInvestigationLeads[lid];
    if (lead) best = maxStrength(best, lead.strength);
  }
  return best;
}

export function assessEvidenceDrivenCase(state: GameState, caseId: string): EvidenceCaseAssessment {
  const evidence = collectDiscoveredEvidence(state, caseId);
  const confidence = caseConfidence(state, caseId);

  // ── 确认主谋：同一人 ≥2 个不同节点指向，且至少一条 strong，且无 mod/strong 反证 ──
  const implicatingNodes = new Map<string, Set<string>>(); // charId → nodeIds
  const hasStrongImplicate = new Set<string>();
  const blockedByExoneration = new Set<string>();

  // ── 病因收集：每种 ConfirmableCause 的支持节点集合 ──
  const causeNodes = new Map<ConfirmableCause, Set<string>>();
  for (const ct of CONFIRMABLE_CAUSES) causeNodes.set(ct, new Set<string>());
  let hasNonConfirmableCauseSupport = false;
  let hasAnyImplication = false;

  for (const ev of evidence) {
    for (const claim of ev.claims) {
      if (claim.kind === "implicates_character") {
        const set = implicatingNodes.get(claim.characterId) ?? new Set<string>();
        set.add(ev.nodeId);
        implicatingNodes.set(claim.characterId, set);
        if (claim.strength === "strong") hasStrongImplicate.add(claim.characterId);
        hasAnyImplication = true;
      } else if (claim.kind === "exonerates_character") {
        if (claim.strength === "moderate" || claim.strength === "strong") {
          blockedByExoneration.add(claim.characterId);
        }
      } else if (claim.kind === "supports_cause") {
        const ct = claim.causeType as string;
        const set = causeNodes.get(ct as ConfirmableCause);
        if (set !== undefined) {
          set.add(ev.nodeId);
        } else {
          hasNonConfirmableCauseSupport = true;
        }
      }
    }
  }

  // ── 可确认主谋列表 ──
  const confirmableCulpritIds: string[] = [];
  for (const [charId, nodes] of implicatingNodes) {
    if (nodes.size >= 2 && hasStrongImplicate.has(charId) && !blockedByExoneration.has(charId)) {
      confirmableCulpritIds.push(charId);
    }
  }
  confirmableCulpritIds.sort();
  const culpritReady = confirmableCulpritIds.length > 0;

  // ── 病因结构性支持：≥2 独立节点支持某 ConfirmableCause，且无非 ConfirmableCause 的 cause support ──
  // 「结构性支持」忽略是否有人物指认，仅看病因证据本身是否成形，用于矛盾检测。
  const structurallySupportedCauses: ConfirmableCause[] = [];
  if (!hasNonConfirmableCauseSupport) {
    for (const ct of CONFIRMABLE_CAUSES) {
      if (causeNodes.get(ct)!.size >= 2) structurallySupportedCauses.push(ct);
    }
  }
  const causeStructurallySupported = structurallySupportedCauses.length > 0;

  // ── 矛盾检测：主谋成立 + 病因证据成形 = 证据指向两套互斥结论 → 不可裁定，两者均清空 ──
  if (culpritReady && causeStructurallySupported) {
    return { confidence, confirmableCulpritIds: [], confirmableCauseTypes: [], readyForReview: false };
  }

  // ── 可确认病因：结构性支持 + 无任何人物指认（有指认即表示存在他人加害的解释）──
  const confirmableCauseTypes: ConfirmableCause[] = hasAnyImplication ? [] : structurallySupportedCauses;
  const causeReady = confirmableCauseTypes.length > 0;

  const readyForReview = culpritReady || causeReady;
  return { confidence, confirmableCulpritIds, confirmableCauseTypes, readyForReview };
}
