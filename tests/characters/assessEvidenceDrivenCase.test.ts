/**
 * Phase 5B-2B2b: assessEvidenceDrivenCase 纯函数单元测试。
 *
 * 知识边界：assessment 只读取 lead.claims / lead.sourceEvidenceNodeId，
 * 不读取 InvestigationTruth / node.misleading。
 * 蓝图设计保证「误导节点」通过 ≥2 节点门槛这一结构性约束自然被排除，
 * 而非依赖 misleading 标志过滤。
 */
import { describe, expect, it } from "vitest";
import { assessEvidenceDrivenCase } from "../../src/engine/characters/haremInvestigation/assessEvidenceDrivenCase";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import type { InvestigationLeadClaim, IntrigueInvestigationLead } from "../../src/engine/characters/haremInvestigation/types";

const AT = makeGameTime(1, 1, "early");

interface LeadSpec {
  nodeId: string;
  strength?: "tenuous" | "plausible" | "strong" | "confirmed";
  claims: InvestigationLeadClaim[];
}

function build(specs: LeadSpec[]): { state: GameState; caseId: string } {
  const leads: Record<string, IntrigueInvestigationLead> = {};
  const leadIds: string[] = [];
  specs.forEach((spec, i) => {
    const id = `ilead_${String(i + 1).padStart(6, "0")}`;
    leadIds.push(id);
    leads[id] = {
      id, caseId: "icase_a", discoveredAt: AT, method: "medical_examination",
      summaryCode: "x", strength: spec.strength ?? "plausible",
      implicatedIds: [], clearedIds: [], revealedKinds: [],
      sourceEvidenceNodeId: spec.nodeId, claims: spec.claims,
    };
  });
  const c = {
    id: "icase_a", source: { kind: "investigation_incident", reportId: "iarep_a", incidentId: "inc_a" },
    openedAt: AT, openedFromReportKind: "anomaly", status: "open",
    knownTargetIds: ["heir_001"], suspectIds: [], suspectedKinds: [], confidence: "plausible", leadIds,
  };
  // Assessment 不读取 investigationTruths —— 此处传空以确保知识边界
  const state = {
    haremInvestigationCases: [c], haremInvestigationLeads: leads, investigationTruths: [],
  } as unknown as GameState;
  return { state, caseId: "icase_a" };
}

const impl = (id: string, s: "weak" | "moderate" | "strong"): InvestigationLeadClaim => ({ kind: "implicates_character", characterId: id, strength: s });
const exon = (id: string, s: "weak" | "moderate" | "strong"): InvestigationLeadClaim => ({ kind: "exonerates_character", characterId: id, strength: s });
const natural: InvestigationLeadClaim = { kind: "supports_cause", causeType: "natural_illness" };
const neg: InvestigationLeadClaim = { kind: "supports_cause", causeType: "negligence" };

describe("assessEvidenceDrivenCase: 确认主谋", () => {
  it("AS-01: 单节点 strong implicates → insufficient（≥2 节点门槛未满）", () => {
    const { state, caseId } = build([{ nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] }]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("AS-02: 同一 nodeId 两条线索不重复计数 → insufficient", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("AS-03: moderate + strong 不同节点指向同一人 → culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [impl("A", "moderate")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toEqual(["A"]);
    expect(a.confirmableCauseTypes).toEqual([]);
  });

  it("AS-04: 两条不同 strong 节点指向同一人 → culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toContain("A");
  });

  it("AS-05: moderate/strong 反证阻止 culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n3", claims: [exon("A", "moderate")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("AS-06: 两个不同人物各有一节点 → 不错误合并 → insufficient", () => {
    const { state, caseId } = build([
      { nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n2", strength: "strong", claims: [impl("B", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("AS-07: 弱反证不阻止 culprit_ready", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [impl("A", "moderate")] },
      { nodeId: "n2", strength: "strong", claims: [impl("A", "strong")] },
      { nodeId: "n3", claims: [exon("A", "weak")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toContain("A");
  });
});

describe("assessEvidenceDrivenCase: 确认病因（ConfirmableCause）", () => {
  it("AS-08: 一条 natural support → insufficient（未满 ≥2 节点）", () => {
    const { state, caseId } = build([{ nodeId: "n1", claims: [natural] }]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCauseTypes).toEqual([]);
  });

  it("AS-09: 两条不同节点 natural support → cause_ready（natural_illness）", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("natural_illness");
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("AS-10: natural + 非 ConfirmableCause support → 不可裁定", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", claims: [{ kind: "supports_cause", causeType: "intentional_harm" }] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
  });

  it("AS-11: 两条 natural 但存在指认 → 不可裁定（有指认说明存在其他解释）", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", claims: [impl("A", "moderate")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCauseTypes).toEqual([]);
  });

  it("AS-12: 两条 negligence support → cause_ready（negligence 是 ConfirmableCause）", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [neg] },
      { nodeId: "n2", claims: [neg] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("negligence");
  });

  it("AS-13: culprit_ready + 病因支持并存 → 矛盾证据，两者均清空", () => {
    const { state, caseId } = build([
      { nodeId: "n1", claims: [natural] },
      { nodeId: "n2", claims: [natural] },
      { nodeId: "n3", claims: [impl("A", "moderate")] },
      { nodeId: "n4", strength: "strong", claims: [impl("A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
    expect(a.confirmableCauseTypes).toEqual([]);
  });

  it("AS-14: insufficient 时 confidence 反映最强线索强度", () => {
    const { state, caseId } = build([{ nodeId: "n1", strength: "strong", claims: [impl("A", "strong")] }]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confidence).toBe("strong");
  });
});

// ── 蓝图可达性：各 causeType 的关键证据组合 ──────────────────────────────────
// 验证真实 evidence blueprints 产生的 claim 序列在 assessment 层能到达合法裁定出口。

describe("assessEvidenceDrivenCase: 蓝图可达性矩阵", () => {
  it("BR-01: intentional_harm — moderate+strong 指认主谋 → culprit_ready", () => {
    // unexplained_payment_to_servant (moderate) + suspect_contact_with_servant (strong)
    const { state, caseId } = build([
      { nodeId: "n_payment", claims: [impl("culprit_A", "moderate")] },
      { nodeId: "n_contact", strength: "strong", claims: [impl("culprit_A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toContain("culprit_A");
  });

  it("BR-02: framing — 真实主谋 moderate+strong（各独立节点）→ culprit_ready；误导单节点不达门槛", () => {
    // surface_evidence_points_to_framed_person (strong) → 只有 1 节点 for framed_B → 不达 ≥2
    // framers_servant_near_scene (moderate) + suspicious_money_or_letter (strong) → culprit_A 达 ≥2
    const { state, caseId } = build([
      { nodeId: "n_surface", strength: "strong", claims: [impl("framed_B", "strong")] },
      { nodeId: "n_servant", claims: [impl("culprit_A", "moderate")] },
      { nodeId: "n_money", strength: "strong", claims: [impl("culprit_A", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toContain("culprit_A");
    expect(a.confirmableCulpritIds).not.toContain("framed_B");
  });

  it("BR-03: false_accusation — accuser moderate+strong 指认 → culprit_ready", () => {
    // accuser_has_old_grievance (moderate) + accuser_directed_false_witness (strong)
    const { state, caseId } = build([
      { nodeId: "n_grievance", claims: [impl("accuser_C", "moderate")] },
      { nodeId: "n_witness", strength: "strong", claims: [impl("accuser_C", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toContain("accuser_C");
  });

  it("BR-04: natural_illness — 两条自然支持节点 → cause_ready（natural_illness）", () => {
    const { state, caseId } = build([
      { nodeId: "n_diagnosis", claims: [natural] },
      { nodeId: "n_drug", claims: [natural] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("natural_illness");
  });

  it("BR-05: negligence — 两条 negligence 支持节点 → cause_ready（negligence）", () => {
    // dosage_mismatch_prescription + missing_decoction_record（均为 supports_cause: negligence）
    const { state, caseId } = build([
      { nodeId: "n_dosage", claims: [neg] },
      { nodeId: "n_record", claims: [neg] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("negligence");
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("BR-06: framing — 仅误导来源的单节点 → insufficient（未满 ≥2 节点门槛）", () => {
    // 仅发现 surface_evidence_points_to_framed_person 时不得过早裁定
    const { state, caseId } = build([
      { nodeId: "n_surface", strength: "strong", claims: [impl("framed_B", "strong")] },
    ]);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });
});
