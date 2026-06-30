/**
 * Phase 5B-2B2b: Cause matrix 集成测试。
 *
 * 用**真实** evidence blueprints（src/.../truth/evidenceBlueprints.ts）物化线索，
 * 模拟「玩家已发现该 cause 分支全部可发现证据（含误导节点）」的终局状态，
 * 再跑 assessEvidenceDrivenCase，验证每个 cause 分支都有合法裁定出口（终局）。
 *
 * 关键不变量：assessment 不读取 node.misleading；即便误导节点被发现，
 * 也不得据其产生错误的主谋裁定（如把被嫁祸者认定为主谋）。
 * 任一蓝图编辑若破坏「分支可达终局」或「误导节点不污染裁定」，此处即失败。
 */
import { describe, expect, it } from "vitest";
import { assessEvidenceDrivenCase } from "../../src/engine/characters/haremInvestigation/assessEvidenceDrivenCase";
import { getBlueprintsForCause } from "../../src/engine/characters/haremInvestigation/truth/evidenceBlueprints";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import type { InvestigationCauseType } from "../../src/engine/characters/haremInvestigation/truth/types";
import type { BlueprintClaim } from "../../src/engine/characters/haremInvestigation/truth/evidenceBlueprints";
import type { InvestigationLeadClaim, IntrigueInvestigationLead } from "../../src/engine/characters/haremInvestigation/types";

const AT = makeGameTime(1, 1, "early");

// 固定符号绑定，复刻 truthResolver.bindClaim 的语义
const CULPRIT_ID = "char_culprit";
const FRAMED_ID = "char_framed";
const ACCUSED_ID = "char_accused";

function bindRef(ref: "culprit" | "framing_target" | "accused"): string {
  return ref === "culprit" ? CULPRIT_ID : ref === "framing_target" ? FRAMED_ID : ACCUSED_ID;
}

/** 把单个 blueprint claim 脱敏为 lead claim（复刻 settlement.materializeLeadFromEvidence 的映射）。 */
function toLeadClaim(bp: BlueprintClaim): InvestigationLeadClaim | null {
  switch (bp.kind) {
    case "implicates_character":
      return { kind: "implicates_character", characterId: bindRef(bp.characterRef), strength: bp.strength };
    case "exonerates_character":
      return { kind: "exonerates_character", characterId: bindRef(bp.characterRef), strength: bp.strength };
    case "supports_cause":
      return { kind: "supports_cause", causeType: bp.causeType };
    case "reveals_method":
    case "reveals_method_ref":
      return { kind: "reveals_mechanism", mechanism: "wrong_dosage" };
    case "establishes_fact":
      return { kind: "establishes_fact", factCode: bp.factCode };
  }
}

/**
 * 为某 cause 分支构造「已发现全部蓝图节点」的案件状态。
 * @param includeMisleading 是否把误导节点也算作已发现（默认 true，测试知识边界）。
 */
function buildDiscoveredCase(causeType: InvestigationCauseType, includeMisleading = true): { state: GameState; caseId: string } {
  const blueprints = getBlueprintsForCause(causeType).filter((bp) => includeMisleading || !bp.misleading);
  const leads: Record<string, IntrigueInvestigationLead> = {};
  const leadIds: string[] = [];
  blueprints.forEach((bp, i) => {
    const id = `ilead_${String(i + 1).padStart(6, "0")}`;
    leadIds.push(id);
    const claims = bp.claims.map(toLeadClaim).filter((c): c is InvestigationLeadClaim => c !== null);
    leads[id] = {
      id, caseId: "icase_m", discoveredAt: AT, method: bp.discoverableBy[0] as never,
      summaryCode: `evidence_${bp.factCode}`, strength: "plausible",
      implicatedIds: [], clearedIds: [], revealedKinds: [],
      sourceEvidenceNodeId: `node_${bp.factCode}`, claims,
    };
  });
  const c = {
    id: "icase_m", source: { kind: "investigation_incident", reportId: "iarep_m", incidentId: "inc_m" },
    openedAt: AT, openedFromReportKind: "anomaly", status: "open",
    knownTargetIds: ["heir_001"], suspectIds: [CULPRIT_ID, FRAMED_ID, ACCUSED_ID], suspectedKinds: [],
    confidence: "plausible", leadIds,
  };
  const state = {
    haremInvestigationCases: [c], haremInvestigationLeads: leads, investigationTruths: [],
  } as unknown as GameState;
  return { state, caseId: "icase_m" };
}

describe("5B-2B2b cause matrix: 每个 cause 分支发现全部证据后都有终局", () => {
  it("CM-natural_illness: 全部证据 → cause_ready(natural_illness)，无主谋", () => {
    const { state, caseId } = buildDiscoveredCase("natural_illness");
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("natural_illness");
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("CM-accident: 复用 natural_illness 蓝图 → cause_ready(natural_illness)", () => {
    // accident 当前复用 NATURAL_ILLNESS_BLUEPRINTS（见 getBlueprintsForCause）
    const { state, caseId } = buildDiscoveredCase("accident");
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("natural_illness");
  });

  it("CM-negligence: 全部证据 → cause_ready(negligence)，无主谋", () => {
    const { state, caseId } = buildDiscoveredCase("negligence");
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCauseTypes).toContain("negligence");
    expect(a.confirmableCulpritIds).toEqual([]);
  });

  it("CM-intentional_harm: 全部证据 → culprit_ready(culprit)，无病因", () => {
    const { state, caseId } = buildDiscoveredCase("intentional_harm");
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toEqual([CULPRIT_ID]);
    expect(a.confirmableCauseTypes).toEqual([]);
  });

  it("CM-framing: 含误导节点全部发现 → culprit_ready(真凶)，被嫁祸者不入主谋名单", () => {
    const { state, caseId } = buildDiscoveredCase("framing", /* includeMisleading */ true);
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toEqual([CULPRIT_ID]);
    // 知识边界关键断言：误导节点（指认被嫁祸者）被发现，但不得据此裁定被嫁祸者
    expect(a.confirmableCulpritIds).not.toContain(FRAMED_ID);
  });

  it("CM-false_accusation: 全部证据 → culprit_ready(诬告者)，无病因", () => {
    const { state, caseId } = buildDiscoveredCase("false_accusation");
    const a = assessEvidenceDrivenCase(state, caseId);
    expect(a.readyForReview).toBe(true);
    expect(a.confirmableCulpritIds).toEqual([CULPRIT_ID]);
    expect(a.confirmableCauseTypes).toEqual([]);
  });
});

describe("5B-2B2b cause matrix: framing 早期（仅误导节点）不得过早裁定", () => {
  it("CM-framing-early: 仅发现误导 surface 节点 → 无终局", () => {
    // 只发现 misleading 节点（指认被嫁祸者）时，单节点不达 ≥2 门槛 → 不可裁定
    const blueprints = getBlueprintsForCause("framing").filter((bp) => bp.misleading);
    expect(blueprints.length).toBeGreaterThan(0);
    const leads: Record<string, IntrigueInvestigationLead> = {};
    const leadIds: string[] = [];
    blueprints.forEach((bp, i) => {
      const id = `ilead_${String(i + 1).padStart(6, "0")}`;
      leadIds.push(id);
      leads[id] = {
        id, caseId: "icase_e", discoveredAt: AT, method: bp.discoverableBy[0] as never,
        summaryCode: `evidence_${bp.factCode}`, strength: "strong",
        implicatedIds: [], clearedIds: [], revealedKinds: [],
        sourceEvidenceNodeId: `node_${bp.factCode}`,
        claims: bp.claims.map(toLeadClaim).filter((c): c is InvestigationLeadClaim => c !== null),
      };
    });
    const c = {
      id: "icase_e", source: { kind: "investigation_incident", reportId: "iarep_e", incidentId: "inc_e" },
      openedAt: AT, openedFromReportKind: "anomaly", status: "open",
      knownTargetIds: ["heir_001"], suspectIds: [FRAMED_ID], suspectedKinds: [], confidence: "strong", leadIds,
    };
    const state = { haremInvestigationCases: [c], haremInvestigationLeads: leads, investigationTruths: [] } as unknown as GameState;
    const a = assessEvidenceDrivenCase(state, "icase_e");
    expect(a.readyForReview).toBe(false);
    expect(a.confirmableCulpritIds).toEqual([]);
  });
});
