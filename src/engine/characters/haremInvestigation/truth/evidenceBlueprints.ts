/**
 * Evidence blueprints — one set per cause branch.
 * Each blueprint is a HiddenEvidenceNode minus the `id` field,
 * which is assigned deterministically by truthResolver.
 * Character refs use symbolic names ("culprit", "framing_target", "accused")
 * that are resolved to actual character IDs by the resolver.
 */
import type {
  EvidenceType,
  InvestigationActionType,
  InvestigationCauseType,
  InvestigationMethod,
} from "./types";

export type BlueprintClaim =
  | { kind: "implicates_character"; characterRef: "culprit" | "framing_target" | "accused"; strength: "weak" | "moderate" | "strong" }
  | { kind: "exonerates_character"; characterRef: "accused" | "framing_target"; strength: "weak" | "moderate" | "strong" }
  | { kind: "supports_cause"; causeType: InvestigationCauseType }
  | { kind: "reveals_method"; method: InvestigationMethod }
  | { kind: "reveals_method_ref" }  // bound to truth.method at resolve time
  | { kind: "establishes_fact"; factCode: string };

export interface EvidenceBlueprint {
  type: EvidenceType;
  factCode: string;
  claims: BlueprintClaim[];
  difficulty: number;
  decayPerPeriod: number;
  discoverableBy: InvestigationActionType[];
  prerequisiteEvidenceIds: string[];
  misleading: boolean;
}

// ── Natural illness ───────────────────────────────────────────────────────────
export const NATURAL_ILLNESS_BLUEPRINTS: readonly EvidenceBlueprint[] = [
  {
    type: "medical",
    factCode: "diagnosis_matches_old_illness",
    claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
    difficulty: 20,
    decayPerPeriod: 5,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "medical",
    factCode: "drug_residue_normal",
    claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
    difficulty: 30,
    decayPerPeriod: 8,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "timeline",
    factCode: "timeline_precedes_suspect_arrival",
    claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
    difficulty: 25,
    decayPerPeriod: 3,
    discoverableBy: ["reconstruct_timeline", "question_servants"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "no_outside_contact_path",
    claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
    difficulty: 35,
    decayPerPeriod: 10,
    discoverableBy: ["question_servants", "obtain_testimony"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
];

// ── Negligence ────────────────────────────────────────────────────────────────
export const NEGLIGENCE_BLUEPRINTS: readonly EvidenceBlueprint[] = [
  {
    type: "medical",
    factCode: "dosage_mismatch_prescription",
    claims: [
      { kind: "supports_cause", causeType: "negligence" },
      { kind: "reveals_method_ref" },
    ],
    difficulty: 40,
    decayPerPeriod: 8,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "physical",
    factCode: "missing_decoction_record",
    claims: [{ kind: "supports_cause", causeType: "negligence" }],
    difficulty: 45,
    decayPerPeriod: 10,
    discoverableBy: ["search_quarters", "question_servants"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "inconsistent_servant_testimony",
    claims: [{ kind: "supports_cause", causeType: "negligence" }],
    difficulty: 50,
    decayPerPeriod: 12,
    discoverableBy: ["question_servants", "obtain_testimony"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
];

// ── Intentional harm ──────────────────────────────────────────────────────────
export const INTENTIONAL_HARM_BLUEPRINTS: readonly EvidenceBlueprint[] = [
  {
    type: "medical",
    factCode: "abnormal_drug_residue",
    claims: [{ kind: "supports_cause", causeType: "intentional_harm" }],
    difficulty: 50,
    decayPerPeriod: 10,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "financial",
    factCode: "unexplained_payment_to_servant",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "moderate" },
    ],
    difficulty: 60,
    decayPerPeriod: 15,
    discoverableBy: ["trace_money"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "suspect_contact_with_servant",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "strong" },
    ],
    difficulty: 55,
    decayPerPeriod: 12,
    discoverableBy: ["question_servants", "obtain_testimony"],
    prerequisiteEvidenceIds: ["unexplained_payment_to_servant"],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "servant_final_confession",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "strong" },
    ],
    difficulty: 70,
    decayPerPeriod: 5,
    discoverableBy: ["obtain_testimony"],
    prerequisiteEvidenceIds: ["suspect_contact_with_servant"],
    misleading: false,
  },
];

// ── Framing ───────────────────────────────────────────────────────────────────
export const FRAMING_BLUEPRINTS: readonly EvidenceBlueprint[] = [
  {
    type: "physical",
    factCode: "surface_evidence_points_to_framed_person",
    claims: [
      { kind: "implicates_character", characterRef: "framing_target", strength: "strong" },
    ],
    difficulty: 20,
    decayPerPeriod: 3,
    discoverableBy: ["search_quarters", "question_servants"],
    prerequisiteEvidenceIds: [],
    misleading: true,
  },
  {
    type: "physical",
    factCode: "medicine_left_unattended",
    claims: [{ kind: "supports_cause", causeType: "framing" }],
    difficulty: 40,
    decayPerPeriod: 8,
    discoverableBy: ["search_quarters"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "framers_servant_near_scene",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "moderate" },
    ],
    difficulty: 55,
    decayPerPeriod: 12,
    discoverableBy: ["question_servants", "reconstruct_timeline"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "financial",
    factCode: "suspicious_money_or_letter",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "moderate" },
    ],
    difficulty: 65,
    decayPerPeriod: 15,
    discoverableBy: ["trace_money", "search_quarters"],
    prerequisiteEvidenceIds: ["framers_servant_near_scene"],
    misleading: false,
  },
];

// ── False accusation ──────────────────────────────────────────────────────────
export const FALSE_ACCUSATION_BLUEPRINTS: readonly EvidenceBlueprint[] = [
  {
    type: "medical",
    factCode: "illness_not_man_made",
    claims: [{ kind: "supports_cause", causeType: "false_accusation" }],
    difficulty: 35,
    decayPerPeriod: 8,
    discoverableBy: ["medical_examination"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "timeline",
    factCode: "timeline_conflict_in_accusation",
    claims: [{ kind: "supports_cause", causeType: "false_accusation" }],
    difficulty: 45,
    decayPerPeriod: 10,
    discoverableBy: ["reconstruct_timeline"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
  {
    type: "testimony",
    factCode: "servants_pressured_unified_testimony",
    claims: [{ kind: "supports_cause", causeType: "false_accusation" }],
    difficulty: 55,
    decayPerPeriod: 12,
    discoverableBy: ["question_servants", "obtain_testimony"],
    prerequisiteEvidenceIds: ["timeline_conflict_in_accusation"],
    misleading: false,
  },
  {
    type: "correspondence",
    factCode: "accuser_has_old_grievance",
    claims: [
      { kind: "implicates_character", characterRef: "culprit", strength: "weak" },
    ],
    difficulty: 60,
    decayPerPeriod: 5,
    discoverableBy: ["search_quarters", "obtain_testimony"],
    prerequisiteEvidenceIds: [],
    misleading: false,
  },
];

/**
 * Return the blueprint list for the given cause type.
 * `accident` reuses the natural_illness blueprints (no culprit, benign cause).
 */
export function getBlueprintsForCause(
  causeType: InvestigationCauseType,
): readonly EvidenceBlueprint[] {
  switch (causeType) {
    case "natural_illness":
    case "accident":
      return NATURAL_ILLNESS_BLUEPRINTS;
    case "negligence":
      return NEGLIGENCE_BLUEPRINTS;
    case "intentional_harm":
      return INTENTIONAL_HARM_BLUEPRINTS;
    case "framing":
      return FRAMING_BLUEPRINTS;
    case "false_accusation":
      return FALSE_ACCUSATION_BLUEPRINTS;
  }
}
