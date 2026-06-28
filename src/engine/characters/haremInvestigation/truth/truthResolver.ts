/**
 * Truth resolver (Phase 5B-2A) — deterministic, seeded, pure function.
 * Takes a HeirHealthTruthContext (built at incident-creation time) and
 * returns an InvestigationTruth. Does NOT read or write GameState.
 */
import type { GameState } from "../../../../engine/state/types";
import { isInColdPalace } from "../../coldPalace";
import type { BlueprintClaim } from "./evidenceBlueprints";
import { getBlueprintsForCause } from "./evidenceBlueprints";
import type {
  EvidenceClaim,
  HeirHealthAnomalyIncident,
  HeirHealthTruthContext,
  HiddenEvidenceNode,
  InvestigationCauseType,
  IncidentMechanism,
  InvestigationMotive,
  InvestigationTruth,
  TruthCandidateSnapshot,
} from "./types";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

/** Deterministic seeded PRNG (mulberry32). Returns a function that yields [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Hash a string to a uint32 (FNV-1a-32). Exported for use in store action. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Weighted selection ────────────────────────────────────────────────────────

type CauseWeight = Record<InvestigationCauseType, number>;

const BASE_WEIGHTS: CauseWeight = {
  natural_illness: 40,
  accident: 0,       // reserved for scripted events; RNG doesn't generate it
  negligence: 25,
  intentional_harm: 12,
  framing: 13,
  false_accusation: 10,
};

function weightedPick<T>(
  rng: () => number,
  items: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = rng() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i]!;
    if (rand <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

// ── Method / motive mapping ───────────────────────────────────────────────────

function methodForCause(causeType: InvestigationCauseType, rng: () => number): IncidentMechanism {
  switch (causeType) {
    case "natural_illness":
    case "accident":
      return "none";
    case "negligence": {
      const methods: IncidentMechanism[] = ["wrong_dosage", "contaminated_medicine", "treatment_delay", "medicine_mixup"];
      return methods[Math.floor(rng() * methods.length)]!;
    }
    case "intentional_harm":
      return rng() < 0.5 ? "tampered_medicine" : "hallucinogenic_herb";
    case "framing":
      return rng() < 0.5 ? "fabricated_testimony" : "tampered_medicine";
    case "false_accusation":
      return "fabricated_testimony";
  }
}

function motiveForCause(causeType: InvestigationCauseType, rng: () => number): InvestigationMotive {
  switch (causeType) {
    case "natural_illness":
    case "accident":
      return "none";
    case "negligence":
      return "conceal_negligence";
    case "intentional_harm": {
      const motives: InvestigationMotive[] = ["succession_rivalry", "jealousy", "personal_grievance"];
      return motives[Math.floor(rng() * motives.length)]!;
    }
    case "framing":
      return rng() < 0.6 ? "frame_rival" : "succession_rivalry";
    case "false_accusation":
      return rng() < 0.6 ? "personal_grievance" : "jealousy";
  }
}

// ── Candidate selection from snapshots ───────────────────────────────────────

/** Compute culprit weight for intentional_harm based on snapshot. */
function culpritWeight(c: TruthCandidateSnapshot): number {
  return Math.max(0,
    c.motiveScore + c.opportunityScore + c.accessScore
    + c.scheming * 0.3
    + c.ambition * 0.4
    - c.loyalty * 0.5
  );
}

/** Pick one candidate by weighted random selection. Falls back to uniform if all weights are 0. */
function weightedPickCandidate(
  rng: () => number,
  candidates: TruthCandidateSnapshot[],
  weightFn: (c: TruthCandidateSnapshot) => number,
): TruthCandidateSnapshot {
  const weights = candidates.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return candidates[Math.floor(rng() * candidates.length)]!;
  }
  let rand = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i]!;
    if (rand <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/** Pick one candidate uniformly at random. */
function pickOne(rng: () => number, candidates: TruthCandidateSnapshot[]): TruthCandidateSnapshot {
  return candidates[Math.floor(rng() * candidates.length)]!;
}

// ── Claim binding ─────────────────────────────────────────────────────────────

/**
 * Bind a blueprint claim's symbolic refs to actual character IDs and method.
 * `reveals_method_ref` is bound to the truth's resolved method.
 */
function bindClaim(
  blueprintClaim: BlueprintClaim,
  resolvedMethod: IncidentMechanism,
  culpritId?: string,
  framingTargetId?: string,
  accusedId?: string,
): EvidenceClaim {
  if (blueprintClaim.kind === "reveals_method_ref") {
    return { kind: "reveals_method", method: resolvedMethod };
  }
  if (
    blueprintClaim.kind === "implicates_character" ||
    blueprintClaim.kind === "exonerates_character"
  ) {
    const resolvedId =
      blueprintClaim.characterRef === "culprit" ? culpritId :
      blueprintClaim.characterRef === "framing_target" ? framingTargetId :
      blueprintClaim.characterRef === "accused" ? accusedId : undefined;
    if (resolvedId !== undefined) {
      return { ...blueprintClaim, characterRef: resolvedId };
    }
    return { kind: "establishes_fact", factCode: `${blueprintClaim.characterRef}_unknown` };
  }
  return blueprintClaim as EvidenceClaim;
}

// ── Main resolver (pure function) ─────────────────────────────────────────────

/**
 * Generate InvestigationTruth from a HeirHealthTruthContext and game RNG seed.
 * Pure function — does not read or write GameState.
 * Deterministic: same context + same seed → same result.
 */
export function resolveInvestigationTruth(
  context: HeirHealthTruthContext,
  gameRngSeed: number,
): InvestigationTruth {
  const { incident, candidateSnapshots, victimHealth } = context;
  const truthId = `itruth_${incident.id}`;

  const seed = hashStr(`${gameRngSeed}:${incident.id}:${incident.sourceKey}`);
  const rng = mulberry32(seed);

  const medicineAccessCandidates = candidateSnapshots.filter((c) => c.canAccessMedicine);

  // Precompute accuser/accused candidate sets for false_accusation and framing
  const accuserCandidates = candidateSnapshots.filter((c) =>
    incident.accuserIds.includes(c.characterId),
  );
  // For false_accusation: culprit from accuserIds, accused from initiallyAccusedIds (no overlap)
  const falseAccusationAccusedIds = incident.initiallyAccusedIds.filter(
    (id) => !incident.accuserIds.includes(id),
  );
  const canDoFalseAccusation =
    accuserCandidates.length > 0 && falseAccusationAccusedIds.length > 0;

  // For framing: target = initiallyAccused, culprit from medicine-capable candidates excluding target
  const framingTargetPool = incident.initiallyAccusedIds;
  const framingCulpritCandidates = medicineAccessCandidates.filter(
    (c) => !framingTargetPool.includes(c.characterId),
  );
  const canDoFraming = framingTargetPool.length > 0 && framingCulpritCandidates.length > 0;

  // ── Weight adjustment ────────────────────────────────────────────────────────

  const weights = { ...BASE_WEIGHTS };

  // victimHealth: lower health → more likely natural illness (or negligence)
  const healthRisk = Math.max(0, 70 - Math.min(100, Math.max(0, victimHealth)));
  weights.natural_illness += Math.floor(healthRisk * 0.6);
  weights.negligence += Math.floor(healthRisk * 0.1);

  // Hard availability filters
  if (medicineAccessCandidates.length === 0) {
    weights.intentional_harm = 0;
  }
  if (!canDoFraming) {
    weights.framing = 0;
  }
  if (!canDoFalseAccusation) {
    weights.false_accusation = 0;
  }

  // Select cause type via weighted pick
  const causeEntries = (Object.entries(weights) as [InvestigationCauseType, number][]).filter(
    ([, w]) => w > 0,
  );
  const causeTypes = causeEntries.map(([k]) => k);
  const causeWeights = causeEntries.map(([, v]) => v);
  const causeType = weightedPick(rng, causeTypes, causeWeights);

  // ── Determine culprit / accused / framingTarget ───────────────────────────

  let culpritIds: string[] = [];
  let accusedIds: string[] = [];
  let framingTargetIds: string[] = [];

  if (causeType === "intentional_harm" && medicineAccessCandidates.length > 0) {
    const culprit = weightedPickCandidate(rng, medicineAccessCandidates, culpritWeight);
    culpritIds = [culprit.characterId];
  } else if (causeType === "framing" && canDoFraming) {
    // Culprit is a medicine-capable candidate who is NOT the framing target
    const culprit = weightedPickCandidate(rng, framingCulpritCandidates, culpritWeight);
    culpritIds = [culprit.characterId];
    // Framing target comes from the publicly accused — pick one
    const targetId = framingTargetPool[Math.floor(rng() * framingTargetPool.length)]!;
    framingTargetIds = [targetId];
    accusedIds = [targetId];
  } else if (causeType === "false_accusation" && canDoFalseAccusation) {
    // Culprit is the accuser; accused is one of the falsely accused
    const accuser = pickOne(rng, accuserCandidates);
    culpritIds = [accuser.characterId];
    const accusedId = falseAccusationAccusedIds[
      Math.floor(rng() * falseAccusationAccusedIds.length)
    ]!;
    accusedIds = [accusedId];
  }

  // Concealment: 40–80 range
  const concealment = Math.floor(rng() * 40 + 40);

  // Method and motive
  const method = methodForCause(causeType, rng);
  const motive = motiveForCause(causeType, rng);

  // ── Materialize evidence nodes ─────────────────────────────────────────────

  const blueprints = getBlueprintsForCause(causeType);

  const factCodeToId: Record<string, string> = {};
  for (let idx = 0; idx < blueprints.length; idx++) {
    const bp = blueprints[idx]!;
    factCodeToId[bp.factCode] = `evidence_${truthId}_${bp.factCode}_${idx}`;
  }

  const culpritId = culpritIds[0];
  const framingTargetId = framingTargetIds[0];
  const accusedId = accusedIds[0];

  const evidenceNodes: HiddenEvidenceNode[] = blueprints.map((bp) => ({
    id: factCodeToId[bp.factCode]!,
    type: bp.type,
    factCode: bp.factCode,
    claims: bp.claims.map((c) => bindClaim(c, method, culpritId, framingTargetId, accusedId)),
    difficulty: bp.difficulty,
    decayPerPeriod: bp.decayPerPeriod,
    discoverableBy: bp.discoverableBy,
    prerequisiteEvidenceIds: bp.prerequisiteEvidenceIds.map(
      (fc) => factCodeToId[fc] ?? `evidence_${truthId}_${fc}_unknown`,
    ),
    misleading: bp.misleading,
  }));

  return {
    id: truthId,
    incidentId: incident.id,
    eventFamily: "heir_health_anomaly",
    causeType,
    culpritIds,
    accusedIds,
    framingTargetIds,
    method,
    motive,
    concealment,
    evidenceNodes,
    generatedAt: incident.occurredAt,
    sourceKey: incident.sourceKey,
  };
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build HeirHealthTruthContext from game state at event time.
 * Called at incident-creation time, not at investigation time.
 * Excludes deceased and candidate-status consorts.
 */
export function buildHeirHealthTruthContext(
  incident: HeirHealthAnomalyIncident,
  state: GameState,
  victimHealth: number,
): HeirHealthTruthContext {
  const candidateSnapshots: TruthCandidateSnapshot[] = Object.entries(state.standing)
    .filter(([charId, st]) => {
      if (!st.rank) return false;
      // Exclude inactive lifecycles
      if (st.lifecycle === "deceased" || st.lifecycle === "candidate") return false;
      const inColdPalace = isInColdPalace(state, charId, state.calendar.dayIndex);
      if (inColdPalace) return false;
      return true;
    })
    .map(([charId, st]) => {
      const servantOpinion = st.household?.servantOpinion ?? 0;
      const livingStandard = st.household?.livingStandard ?? 0;
      const privateWealthLevel = st.household?.privateWealthLevel ?? 0;
      const ambition = st.ambition ?? 35;
      const loyalty = st.loyalty ?? 50;
      const scheming = st.personality?.scheming ?? 50;

      const canAccessMedicine = privateWealthLevel > 20 || servantOpinion > 50;
      const canInfluenceServants = servantOpinion > 40 && privateWealthLevel > 10;

      const motiveScore = Math.max(0,
        ambition - loyalty * 0.5 + (scheming - 50) * 0.3,
      );
      const opportunityScore = livingStandard * 0.5;
      const accessScore = (canAccessMedicine ? 30 : 0) + (canInfluenceServants ? 20 : 0);

      return {
        characterId: charId,
        motiveScore,
        opportunityScore,
        accessScore,
        ambition,
        loyalty,
        scheming,
        privateWealthLevel,
        canAccessMedicine,
        canInfluenceServants,
      } satisfies TruthCandidateSnapshot;
    });

  return { incident, victimHealth, candidateSnapshots };
}
