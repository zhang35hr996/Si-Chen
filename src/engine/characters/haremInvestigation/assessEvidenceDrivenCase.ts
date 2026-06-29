/**
 * 证据驱动案件评估（Phase 5B-2B2b）。
 *
 * 纯函数：只读取案件「已发现」证据（case leads 的 claims / sourceEvidenceNodeId），
 * 允许用 sourceEvidenceNodeId 回查对应 node 的 misleading/type（判断该已发现证据是否
 * 属于误导证据的内部元数据）。**绝不读取 truth.causeType / culpritIds / method** 等真相结论。
 *
 * 据此判断案件是否具备一种合法裁定出口（确认主谋 / 确认自然病因），供 settlement 决定
 * 是否进入 ready_for_review、供 review 校验玩家裁定。
 */
import type { GameState } from "../../state/types";
import type { HaremIntrigueReportConfidence } from "../../state/types";
import type { InvestigationLeadStrength } from "./types";

export type EvidenceCaseAssessment =
  | { kind: "insufficient"; confidence: HaremIntrigueReportConfidence }
  | { kind: "culprit_ready"; confidence: "confirmed"; confirmableCulpritIds: string[] }
  | { kind: "benign_ready"; confidence: "confirmed"; causeType: "natural_illness" };

const STRENGTH_ORDER: InvestigationLeadStrength[] = ["tenuous", "plausible", "strong", "confirmed"];
function maxStrength(a: InvestigationLeadStrength, b: InvestigationLeadStrength): InvestigationLeadStrength {
  return STRENGTH_ORDER.indexOf(a) >= STRENGTH_ORDER.indexOf(b) ? a : b;
}

/** 单个已发现证据节点的脱敏视图（来自一条 Lead + 其来源 node 元数据）。 */
interface DiscoveredEvidence {
  nodeId: string;
  misleading: boolean;
  claims: NonNullable<GameState["haremInvestigationLeads"][string]["claims"]>;
}

/**
 * 收集案件「已发现」的证据节点（去重：同 nodeId 只取一次）。
 * misleading 由来源 node 元数据决定；无对应 truth/node 时按非误导处理（防御）。
 */
function collectDiscoveredEvidence(state: GameState, caseId: string): DiscoveredEvidence[] {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c || c.source.kind !== "investigation_incident") return [];
  const truth = state.investigationTruths.find((t) => t.incidentId === c.source.incidentId);
  const nodeMisleading = new Map<string, boolean>();
  if (truth) for (const n of truth.evidenceNodes) nodeMisleading.set(n.id, n.misleading);

  const seen = new Set<string>();
  const out: DiscoveredEvidence[] = [];
  for (const lid of c.leadIds) {
    const lead = state.haremInvestigationLeads[lid];
    if (!lead || !lead.sourceEvidenceNodeId || !lead.claims) continue;
    if (seen.has(lead.sourceEvidenceNodeId)) continue;
    seen.add(lead.sourceEvidenceNodeId);
    out.push({
      nodeId: lead.sourceEvidenceNodeId,
      misleading: nodeMisleading.get(lead.sourceEvidenceNodeId) ?? false,
      claims: lead.claims,
    });
  }
  return out;
}

function caseConfidence(state: GameState, caseId: string): HaremIntrigueReportConfidence {
  const c = state.haremInvestigationCases.find((x) => x.id === caseId);
  if (!c) return "tenuous";
  let best: InvestigationLeadStrength = "tenuous";
  for (const lid of c.leadIds) {
    const lead = state.haremInvestigationLeads[lid];
    if (lead) best = maxStrength(best, lead.strength);
  }
  return best;
}

export function assessEvidenceDrivenCase(state: GameState, caseId: string): EvidenceCaseAssessment {
  const evidence = collectDiscoveredEvidence(state, caseId);
  const nonMisleading = evidence.filter((e) => !e.misleading);

  // ── 确认主谋：同一人 ≥2 个不同非误导节点指向，且至少一条 strong，且无 mod/strong 反证 ──
  // 每个角色：指向其的非误导节点集合 + 是否有 strong implicates + 是否被 mod/strong exonerate
  const implicatingNodes = new Map<string, Set<string>>(); // charId → nodeIds
  const hasStrongImplicate = new Set<string>();
  const blockedByExoneration = new Set<string>();

  for (const ev of nonMisleading) {
    for (const claim of ev.claims) {
      if (claim.kind === "implicates_character") {
        const set = implicatingNodes.get(claim.characterId) ?? new Set<string>();
        set.add(ev.nodeId);
        implicatingNodes.set(claim.characterId, set);
        if (claim.strength === "strong") hasStrongImplicate.add(claim.characterId);
      } else if (claim.kind === "exonerates_character") {
        if (claim.strength === "moderate" || claim.strength === "strong") {
          blockedByExoneration.add(claim.characterId);
        }
      }
    }
  }

  const confirmableCulpritIds: string[] = [];
  for (const [charId, nodes] of implicatingNodes) {
    if (nodes.size >= 2 && hasStrongImplicate.has(charId) && !blockedByExoneration.has(charId)) {
      confirmableCulpritIds.push(charId);
    }
  }
  confirmableCulpritIds.sort();
  if (confirmableCulpritIds.length > 0) {
    return { kind: "culprit_ready", confidence: "confirmed", confirmableCulpritIds };
  }

  // ── 确认自然病因：≥2 个不同非误导节点 supports_cause natural_illness，
  //    且无任何非误导节点指认他人、亦无其他 causeType 的非误导 supports_cause ──
  const naturalNodes = new Set<string>();
  let hasOtherCauseSupport = false;
  let hasAnyImplication = false;
  for (const ev of nonMisleading) {
    for (const claim of ev.claims) {
      if (claim.kind === "supports_cause") {
        if (claim.causeType === "natural_illness") naturalNodes.add(ev.nodeId);
        else hasOtherCauseSupport = true;
      } else if (claim.kind === "implicates_character") {
        hasAnyImplication = true;
      }
    }
  }
  if (naturalNodes.size >= 2 && !hasOtherCauseSupport && !hasAnyImplication) {
    return { kind: "benign_ready", confidence: "confirmed", causeType: "natural_illness" };
  }

  return { kind: "insufficient", confidence: caseConfidence(state, caseId) };
}
