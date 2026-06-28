/**
 * Phase 5B-2A: InvestigationTruth state validation unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  validateInvestigationIncidents,
  validateInvestigationTruths,
} from "../../src/engine/characters/haremInvestigation/truth/stateValidation";
import type {
  HeirHealthAnomalyIncident,
  HiddenEvidenceNode,
  InvestigationTruth,
} from "../../src/engine/characters/haremInvestigation/truth/types";
import { makeGameTime } from "../../src/engine/calendar/time";

const AT = makeGameTime(1, 1, "early");

const CHAR_ID_A = "char_alice";
const CHAR_ID_B = "char_bob";
const INCIDENT_ID = "incident_001";

function makeNode(overrides: Partial<HiddenEvidenceNode> = {}): HiddenEvidenceNode {
  return {
    id: "evidence_itruth_001_fact_code_0",
    type: "medical",
    factCode: "fact_code",
    claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
    difficulty: 30,
    decayPerPeriod: 5,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
    ...overrides,
  };
}

function makeTruth(overrides: Partial<InvestigationTruth> = {}): InvestigationTruth {
  return {
    id: "itruth_incident_001",
    incidentId: INCIDENT_ID,
    eventFamily: "heir_health_anomaly",
    causeType: "natural_illness",
    culpritIds: [],
    accusedIds: [],
    framingTargetIds: [],
    method: "none",
    motive: "none",
    concealment: 50,
    evidenceNodes: [makeNode()],
    generatedAt: AT,
    sourceKey: "heir_health_anomaly:1:01",
    ...overrides,
  };
}

const ALL_CHARS = new Set([CHAR_ID_A, CHAR_ID_B]);

function makeIncident(overrides: Partial<HeirHealthAnomalyIncident> = {}): HeirHealthAnomalyIncident {
  return {
    id: INCIDENT_ID,
    eventFamily: "heir_health_anomaly",
    occurredAt: AT,
    sourceKey: "heir_health_anomaly:1:01",
    victimHeirId: "heir_001",
    accuserIds: [],
    initiallyAccusedIds: [],
    symptom: "hysteria",
    publicFactCodes: [],
    ...overrides,
  };
}

const BASE_INCIDENT = makeIncident();
const ALL_INCIDENTS = [BASE_INCIDENT];

describe("validateInvestigationTruths", () => {
  it("TV-01: empty truths → no errors", () => {
    const errors = validateInvestigationTruths({
      investigationTruths: [],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors).toHaveLength(0);
  });

  it("TV-02: duplicate truth id → TRUTH_DUPLICATE_ID error", () => {
    const truth1 = makeTruth({ id: "itruth_incident_001" });
    const truth2 = makeTruth({ id: "itruth_incident_001", incidentId: "incident_002" });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth1, truth2],
      investigationIncidents: [BASE_INCIDENT, makeIncident({ id: "incident_002" })],
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_DUPLICATE_ID")).toBe(true);
  });

  it("TV-03: orphan incidentId → TRUTH_ORPHAN_INCIDENT error", () => {
    const truth = makeTruth({ incidentId: "nonexistent_incident" });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: [makeIncident({ id: "other_incident" })],
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_ORPHAN_INCIDENT")).toBe(true);
  });

  it("TV-04: duplicate incidentId across two truths → TRUTH_DUPLICATE_INCIDENT error", () => {
    const truth1 = makeTruth({ id: "itruth_001" });
    const truth2 = makeTruth({ id: "itruth_002" }); // same incidentId as truth1
    const errors = validateInvestigationTruths({
      investigationTruths: [truth1, truth2],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_DUPLICATE_INCIDENT")).toBe(true);
  });

  it("TV-05: natural_illness with culprit → TRUTH_INVALID_CULPRIT error", () => {
    const truth = makeTruth({ causeType: "natural_illness", culpritIds: [CHAR_ID_A] });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_CULPRIT")).toBe(true);
  });

  it("TV-06: intentional_harm without culprit → TRUTH_MISSING_CULPRIT error", () => {
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: [],
      method: "tampered_medicine",
      motive: "jealousy",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_MISSING_CULPRIT")).toBe(true);
  });

  it("TV-07: invalid character in culpritIds → TRUTH_INVALID_CHARACTER error", () => {
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: ["nonexistent_char"],
      method: "tampered_medicine",
      motive: "jealousy",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_CHARACTER")).toBe(true);
  });

  it("TV-08: duplicate evidence id within truth → TRUTH_DUPLICATE_EVIDENCE error", () => {
    const node1 = makeNode({ id: "evidence_001" });
    const node2 = makeNode({ id: "evidence_001", factCode: "fact_code_2" }); // duplicate id
    const truth = makeTruth({ evidenceNodes: [node1, node2] });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_DUPLICATE_EVIDENCE")).toBe(true);
  });

  it("TV-09: invalid prerequisite reference → TRUTH_INVALID_PREREQUISITE error", () => {
    const node = makeNode({ prerequisiteEvidenceIds: ["nonexistent_prereq"] });
    const truth = makeTruth({ evidenceNodes: [node] });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_PREREQUISITE")).toBe(true);
  });

  it("TV-10: dependency cycle → TRUTH_EVIDENCE_CYCLE error", () => {
    const nodeA = makeNode({
      id: "evidence_A",
      factCode: "fact_A",
      prerequisiteEvidenceIds: ["evidence_B"],
    });
    const nodeB = makeNode({
      id: "evidence_B",
      factCode: "fact_B",
      prerequisiteEvidenceIds: ["evidence_A"],
    });
    const truth = makeTruth({ evidenceNodes: [nodeA, nodeB] });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_EVIDENCE_CYCLE")).toBe(true);
  });

  it("TV-11: method=none with intentional_harm → TRUTH_INVALID_METHOD error", () => {
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: [CHAR_ID_A],
      method: "none",
      motive: "jealousy",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_METHOD")).toBe(true);
  });

  it("TV-12: well-formed intentional_harm truth → no errors", () => {
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: [CHAR_ID_A],
      method: "tampered_medicine",
      motive: "jealousy",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors).toHaveLength(0);
  });

  // ── Framing-specific constraints ───────────────────────────────────────────

  it("TV-13: framing without framingTargetIds → TRUTH_MISSING_FRAMING_TARGET error", () => {
    const truth = makeTruth({
      causeType: "framing",
      culpritIds: [CHAR_ID_A],
      framingTargetIds: [],
      accusedIds: [CHAR_ID_B],
      method: "fabricated_testimony",
      motive: "frame_rival",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_MISSING_FRAMING_TARGET")).toBe(true);
  });

  it("TV-14: framing with culprit overlapping framingTargetIds → TRUTH_CULPRIT_IS_FRAMING_TARGET error", () => {
    const truth = makeTruth({
      causeType: "framing",
      culpritIds: [CHAR_ID_A],
      framingTargetIds: [CHAR_ID_A], // same as culprit!
      accusedIds: [CHAR_ID_A],
      method: "fabricated_testimony",
      motive: "frame_rival",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_CULPRIT_IS_FRAMING_TARGET")).toBe(true);
  });

  it("TV-15: well-formed framing truth → no errors", () => {
    const truth = makeTruth({
      causeType: "framing",
      culpritIds: [CHAR_ID_A],
      framingTargetIds: [CHAR_ID_B],
      accusedIds: [CHAR_ID_B],
      method: "fabricated_testimony",
      motive: "frame_rival",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors).toHaveLength(0);
  });

  // ── False accusation-specific constraints ──────────────────────────────────

  it("TV-16: false_accusation without accusedIds → TRUTH_MISSING_ACCUSED error", () => {
    const truth = makeTruth({
      causeType: "false_accusation",
      culpritIds: [CHAR_ID_A],
      accusedIds: [],
      method: "fabricated_testimony",
      motive: "personal_grievance",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_MISSING_ACCUSED")).toBe(true);
  });

  it("TV-17: false_accusation with culprit overlapping accusedIds → TRUTH_CULPRIT_IS_ACCUSED error", () => {
    const truth = makeTruth({
      causeType: "false_accusation",
      culpritIds: [CHAR_ID_A],
      accusedIds: [CHAR_ID_A], // same as culprit!
      method: "fabricated_testimony",
      motive: "personal_grievance",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_CULPRIT_IS_ACCUSED")).toBe(true);
  });

  it("TV-18: well-formed false_accusation truth → no errors", () => {
    const truth = makeTruth({
      causeType: "false_accusation",
      culpritIds: [CHAR_ID_A],
      accusedIds: [CHAR_ID_B],
      method: "fabricated_testimony",
      motive: "personal_grievance",
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors).toHaveLength(0);
  });

  // ── Truth ↔ incident consistency ────────────────────────────────────────────

  it("TV-19: truth.sourceKey ≠ incident.sourceKey → TRUTH_SOURCEKEY_MISMATCH error", () => {
    const truth = makeTruth({ sourceKey: "wrong_key" });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_SOURCEKEY_MISMATCH")).toBe(true);
  });

  it("TV-20: truth.sourceKey matches incident.sourceKey → no mismatch error", () => {
    const truth = makeTruth({ sourceKey: BASE_INCIDENT.sourceKey });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_SOURCEKEY_MISMATCH")).toBe(false);
  });

  // ── Evidence claim character ref validation ─────────────────────────────────

  it("TV-21: implicates_character with nonexistent characterRef → TRUTH_INVALID_CLAIM_CHARACTER error", () => {
    const node = makeNode({
      claims: [{ kind: "implicates_character", characterRef: "ghost_char", strength: "strong" }],
    });
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: [CHAR_ID_A],
      method: "tampered_medicine",
      motive: "jealousy",
      evidenceNodes: [node],
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_CLAIM_CHARACTER")).toBe(true);
  });

  it("TV-22: implicates_character with valid characterRef → no claim character error", () => {
    const node = makeNode({
      claims: [{ kind: "implicates_character", characterRef: CHAR_ID_A, strength: "strong" }],
    });
    const truth = makeTruth({
      causeType: "intentional_harm",
      culpritIds: [CHAR_ID_A],
      method: "tampered_medicine",
      motive: "jealousy",
      evidenceNodes: [node],
    });
    const errors = validateInvestigationTruths({
      investigationTruths: [truth],
      investigationIncidents: ALL_INCIDENTS,
      allCharacterIds: ALL_CHARS,
    });
    expect(errors.some((e) => e.code === "TRUTH_INVALID_CLAIM_CHARACTER")).toBe(false);
  });
});

// ── validateInvestigationIncidents ────────────────────────────────────────────

describe("validateInvestigationIncidents", () => {
  it("TI-01: empty incidents → no errors", () => {
    expect(validateInvestigationIncidents({ investigationIncidents: [] })).toHaveLength(0);
  });

  it("TI-02: duplicate incident id → INCIDENT_DUPLICATE_ID error", () => {
    const errors = validateInvestigationIncidents({
      investigationIncidents: [BASE_INCIDENT, makeIncident({ id: INCIDENT_ID })],
    });
    expect(errors.some((e) => e.code === "INCIDENT_DUPLICATE_ID")).toBe(true);
  });

  it("TI-03: duplicate accuserId → INCIDENT_DUPLICATE_ACCUSER error", () => {
    const errors = validateInvestigationIncidents({
      investigationIncidents: [makeIncident({ accuserIds: [CHAR_ID_A, CHAR_ID_A] })],
    });
    expect(errors.some((e) => e.code === "INCIDENT_DUPLICATE_ACCUSER")).toBe(true);
  });

  it("TI-04: duplicate initiallyAccusedId → INCIDENT_DUPLICATE_ACCUSED error", () => {
    const errors = validateInvestigationIncidents({
      investigationIncidents: [makeIncident({ initiallyAccusedIds: [CHAR_ID_B, CHAR_ID_B] })],
    });
    expect(errors.some((e) => e.code === "INCIDENT_DUPLICATE_ACCUSED")).toBe(true);
  });

  it("TI-05: accuser also appears as accused → INCIDENT_ACCUSER_IS_ACCUSED error", () => {
    const errors = validateInvestigationIncidents({
      investigationIncidents: [
        makeIncident({ accuserIds: [CHAR_ID_A], initiallyAccusedIds: [CHAR_ID_A] }),
      ],
    });
    expect(errors.some((e) => e.code === "INCIDENT_ACCUSER_IS_ACCUSED")).toBe(true);
  });

  it("TI-06: well-formed incident → no errors", () => {
    const errors = validateInvestigationIncidents({
      investigationIncidents: [
        makeIncident({ accuserIds: [CHAR_ID_A], initiallyAccusedIds: [CHAR_ID_B] }),
      ],
    });
    expect(errors).toHaveLength(0);
  });
});
