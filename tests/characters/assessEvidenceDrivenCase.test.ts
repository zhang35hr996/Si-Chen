/**
 * Phase 5B-2B2b: assessEvidenceDrivenCase 纯函数单元测试。
 * 只依据案件已发现证据（leads.claims + node.misleading）判断裁定出口。
 */
import { describe, expect, it } from "vitest";
import { assessEvidenceDrivenCase } from "../../src/engine/characters/haremInvestigation/assessEvidenceDrivenCase";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import type { InvestigationLeadClaim, IntrigueInvestigationLead } from "../../src/engine/characters/haremInvestigation/types";

const AT = makeGameTime(1, 1, "early");

interface LeadSpec {
  nodeId: string;
  misleading?: boolean;
  strength?: "tenuous" | "plausible" | "strong" | "confirmed";
  claims: InvestigationLeadClaim[];
}

function build(specs: LeadSpec[]): { state: GameState; caseId: string } {
  const leads: Record<string, IntrigueInvestigationLead> = {};
  const leadIds: string[] = [];
  const nodeMap = new Map<string, boolean>();
  specs.forEach((spec, i) => {
    const id = `ilead_${String(i + 1).padStart(6, "0")}`;
    leadIds.push(id);
    nodeMap.set(spec.nodeId, spec.misleading ?? false);
    leads[id] = {
      id, caseId: "icase_a", discoveredAt: AT, method: "medical_examination",
      summaryCode: "x", strength: spec.strength ?? "plausible",
      implicatedIds: [], clearedIds: [], revealedKinds: [],
      sourceEvidenceNodeId: spec.nodeId, claims: spec.claims,
    };
  });
  const truth = {
    id: "itruth_inc_a", incidentId: "inc_a", eventFamily: "heir_health_anomaly",
    causeType: "natural_illness", culpritIds: [], accusedIds: [], framingTargetIds: [],
    method: "none", motive: "none", concealment: 0,
    evidenceNodes: [...nodeMap.entries()].map(([id, misleading]) => ({
      id, type: "medical", factCode: id, claims: [], difficulty: 10, decayPerPeriod: 0,
      discoverableBy: ["medical_examination"], prerequisiteEvidenceIds: [], misleading,
    })),
    generatedAt: AT, sourceKey: "k",
  };
  const c = {
    id: "icase_a", source: { kind: "investigation_incident", reportId: "iarep_a", incidentId: "inc_a" },
    openedAt: AT, openedFromReportKind: "anomaly", status: "open",
    knownTargetIds: ["heir_001"], suspectIds: [], suspectedKinds: [], confidence: "plausible", leadIds,
  };
  const state = {
    haremInvestigationCases: [c], haremInvestigationLeads: leads, investigationTruths: [truth],
  } as unknown as GameState;
  return { state, caseId: "icase_a" };
}

const impl = (id: string, s: "weak" | "moderate" | "strong"): InvestigationLeadClaim => ({ kind: "implicates_character", characterId: id, strength: s });
const exon = (id: string, s: "weak" | "moderate" | "strong"): InvestigationLeadClaim => ({ kind: "exonerates_character", characterId: id, strength: s });
const natural: InvestigationLeadClaim = { kind: "supports_cause", causeType: "natural_illness" };

describe("assessEvidenceDrivenCase: 确认主谋", () => {
  it("AS-01: 唯一 strong 证据是 misleading → insufficient", () => {
    const { state, caseId } = build([{ nodeId: "n1", misleading: true, strength: "strong", claims: [impl("A", "strong")] }]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-02: 单条非误导 strong（仅一个节点）→ insufficient", () => {
    const { state, caseId } = build([{ nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] }]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-03: moderate + strong 指向同一人 → culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [impl("A", "moderate")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.kind).toBe("culprit_ready");
    if (a.kind === "culprit_ready") expect(a.confirmableCulpritIds).toEqual(["A"]);
  });

  it("AS-04: 两条不同 strong 节点指向同一人 → culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("culprit_ready");
  });

  it("AS-05: 同一 node 不得被重复计数（两条线索同 nodeId）→ insufficient", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-06: moderate/strong 反证阻止 culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n3", claims: [exon("A", "moderate")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-07: 两个不同人物各有证据 → 不错误合并 → insufficient", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("B", "strong")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });
});

describe("assessEvidenceDrivenCase: 确认自然病因", () => {
  it("AS-08: 一条 natural support → insufficient", () => {
    const { state, caseId } = build([{ nodeId: "n1", claims: [natural] }]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-09: 两条不同 natural support → benign_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.kind).toBe("benign_ready");
    if (a.kind === "benign_ready") expect(a.causeType).toBe("natural_illness");
  });

  it("AS-10: natural + 其他 cause support → 不自动 benign", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", claims: [{ kind: "supports_cause", causeType: "negligence" }] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-11: 两条 natural 但存在指认 → 不 benign", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", claims: [impl("A", "moderate")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-12: misleading 的 natural support 不计入 benign", () => {
    const { state, caseId } = build([
      { nodeId: "n1", misleading: true, claims: [natural] },
      { nodeId: "n2", misleading: true, claims: [natural] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("insufficient");
  });

  it("AS-14: 有指认时即便存在 ≥2 natural support 也不会 benign（互斥保障 + 防御冲突分支）", () => {
    // 同时具备 2 条 natural support 与对 A 的双 strong 指认：
    // benign 因 hasAnyImplication 被否决，结果为 culprit_ready（不会误判 benign）。
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n4", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    expect(assessEvidenceDrivenCase(state, caseId).kind).toBe("culprit_ready");
  });

  it("AS-13: insufficient 时 confidence 反映最强线索（含 misleading strong）", () => {
    const { state, caseId } = build([{ nodeId: "n1", misleading: true, strength: "strong", claims: [impl("A", "strong")] }]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.kind).toBe("insufficient");
    if (a.kind === "insufficient") expect(a.confidence).toBe("strong");
  });
});
