/**
 * Investigation truth layer (Phase 5B-2A) — data-layer-only.
 * Hidden truth about what actually happened in a harem incident.
 * Never exposed to Presenter functions or UI.
 */
import type { GameTime } from "../../../calendar/time";

export type InvestigationCauseType =
  | "natural_illness"
  | "accident"
  | "negligence"
  | "intentional_harm"
  | "framing"
  | "false_accusation";

export type IncidentMechanism =
  | "none"
  | "wrong_dosage"
  | "tampered_medicine"
  | "hallucinogenic_herb"
  | "fabricated_testimony"
  | "induced_symptoms"
  | "contaminated_medicine"
  | "treatment_delay"
  | "medicine_mixup";

export type InvestigationMotive =
  | "none"
  | "succession_rivalry"
  | "jealousy"
  | "personal_grievance"
  | "frame_rival"
  | "conceal_negligence";

export type EvidenceType =
  | "medical"
  | "physical"
  | "testimony"
  | "financial"
  | "timeline"
  | "correspondence";

export type EvidenceDiscoveryAction =
  | "medical_examination"
  | "question_servants"
  | "reconstruct_timeline"
  | "trace_money"
  | "search_quarters"
  | "obtain_testimony";

export type EvidenceClaim =
  | { kind: "implicates_character"; characterRef: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "exonerates_character"; characterRef: string; strength: "weak" | "moderate" | "strong" }
  | { kind: "supports_cause"; causeType: InvestigationCauseType }
  | { kind: "reveals_method"; method: IncidentMechanism }
  | { kind: "establishes_fact"; factCode: string };

export interface HiddenEvidenceNode {
  id: string;
  type: EvidenceType;
  factCode: string;
  /** Structured claims this evidence makes. */
  claims: EvidenceClaim[];
  /** Discovery difficulty 0–100. */
  difficulty: number;
  /** Evidence decay per investigation period. */
  decayPerPeriod: number;
  discoverableBy: EvidenceDiscoveryAction[];
  prerequisiteEvidenceIds: string[];
  /** If true, this evidence leads investigators astray. */
  misleading: boolean;
}

export interface InvestigationTruth {
  /** "itruth_{incidentId}" */
  id: string;
  incidentId: string;
  eventFamily: "heir_health_anomaly";
  causeType: InvestigationCauseType;
  /** Backend truth: actual perpetrators. Empty for natural/accident causes. */
  culpritIds: string[];
  /** Characters the culprit tried to frame. */
  accusedIds: string[];
  /** For framing: the intended framing target. */
  framingTargetIds: string[];
  method: IncidentMechanism;
  motive: InvestigationMotive;
  /** Concealment level 0–100: higher = harder to uncover. */
  concealment: number;
  evidenceNodes: HiddenEvidenceNode[];
  generatedAt: GameTime;
  sourceKey: string;
}

// ── Heir health anomaly incident model ───────────────────────────────────────

export type HeirHealthSymptom =
  | "hysteria"
  | "acute_pain"
  | "high_fever"
  | "convulsions"
  | "excessive_drowsiness";

export interface HeirHealthAnomalyIncident {
  id: string;                         // "heir_health_{heirId}_{hash}"
  eventFamily: "heir_health_anomaly";
  occurredAt: GameTime;
  sourceKey: string;                  // e.g. "heir_health_anomaly:1:03"
  victimHeirId: string;
  custodianId?: string;
  accuserIds: string[];               // who publicly accused someone
  initiallyAccusedIds: string[];      // who was initially publicly accused
  symptom: HeirHealthSymptom;
  publicFactCodes: string[];
}

export type InvestigationIncident = HeirHealthAnomalyIncident;

// ── Truth resolution context (built at incident-creation time) ───────────────

export interface TruthCandidateSnapshot {
  characterId: string;
  motiveScore: number;       // computed from ambition, hostility, succession context
  opportunityScore: number;  // access to victim's environment
  accessScore: number;       // ability to obtain and deliver substances
  ambition: number;
  loyalty: number;
  scheming: number;
  privateWealthLevel: number;
  canAccessMedicine: boolean;    // has resources + servants to tamper with medicine
  canInfluenceServants: boolean; // can bribe or coerce servants
}

export interface HeirHealthTruthContext {
  incident: HeirHealthAnomalyIncident;
  victimHealth: number;          // 0-100: lower → natural_illness more likely
  candidateSnapshots: TruthCandidateSnapshot[];
}
