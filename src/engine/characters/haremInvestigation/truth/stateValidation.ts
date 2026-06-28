/**
 * State validation for investigation incidents and truths (Phase 5B-2A).
 * Only validates truths that exist — does NOT require every incident to have a truth.
 */
import { stateError } from "../../../infra/errors";
import type { GameError } from "../../../infra/errors";
import type { InvestigationIncident, InvestigationTruth } from "./types";

// ── Incident validation ───────────────────────────────────────────────────────

export interface InvestigationIncidentsValidationInput {
  investigationIncidents: InvestigationIncident[];
}

export function validateInvestigationIncidents(
  data: InvestigationIncidentsValidationInput,
): GameError[] {
  const { investigationIncidents } = data;
  const errors: GameError[] = [];
  const seenIds = new Set<string>();

  for (const incident of investigationIncidents) {
    // 1. Unique ID
    if (seenIds.has(incident.id)) {
      errors.push(
        stateError(
          "INCIDENT_DUPLICATE_ID",
          `investigationIncidents: duplicate incident id "${incident.id}"`,
          { context: { id: incident.id } },
        ),
      );
    }
    seenIds.add(incident.id);

    // 2. accuserIds — no duplicates
    const seenAccusers = new Set<string>();
    for (const id of incident.accuserIds) {
      if (seenAccusers.has(id)) {
        errors.push(
          stateError(
            "INCIDENT_DUPLICATE_ACCUSER",
            `investigationIncidents[${incident.id}]: duplicate accuserId "${id}"`,
            { context: { id: incident.id, charId: id } },
          ),
        );
      }
      seenAccusers.add(id);
    }

    // 3. initiallyAccusedIds — no duplicates, no overlap with accuserIds
    const seenAccused = new Set<string>();
    for (const id of incident.initiallyAccusedIds) {
      if (seenAccused.has(id)) {
        errors.push(
          stateError(
            "INCIDENT_DUPLICATE_ACCUSED",
            `investigationIncidents[${incident.id}]: duplicate initiallyAccusedId "${id}"`,
            { context: { id: incident.id, charId: id } },
          ),
        );
      }
      seenAccused.add(id);
      if (seenAccusers.has(id)) {
        errors.push(
          stateError(
            "INCIDENT_ACCUSER_IS_ACCUSED",
            `investigationIncidents[${incident.id}]: character "${id}" is both accuser and accused`,
            { context: { id: incident.id, charId: id } },
          ),
        );
      }
    }
  }

  return errors;
}

// ── Truth validation ──────────────────────────────────────────────────────────

export interface InvestigationTruthsValidationInput {
  investigationTruths: InvestigationTruth[];
  investigationIncidents: InvestigationIncident[];
  allCharacterIds: Set<string>;
}

/** Detect cycles via DFS. Returns true if a cycle is found. */
function hasCycle(
  nodeId: string,
  prereqMap: Map<string, string[]>,
  visited: Set<string>,
  onStack: Set<string>,
): boolean {
  if (onStack.has(nodeId)) return true;
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  onStack.add(nodeId);
  for (const dep of prereqMap.get(nodeId) ?? []) {
    if (hasCycle(dep, prereqMap, visited, onStack)) return true;
  }
  onStack.delete(nodeId);
  return false;
}

export function validateInvestigationTruths(
  data: InvestigationTruthsValidationInput,
): GameError[] {
  const { investigationTruths, investigationIncidents, allCharacterIds } = data;
  const errors: GameError[] = [];

  const investigationIncidentIds = new Set(investigationIncidents.map((i) => i.id));
  const incidentMap = new Map(investigationIncidents.map((i) => [i.id, i]));

  const seenTruthIds = new Set<string>();
  const seenIncidentIds = new Set<string>();

  for (const truth of investigationTruths) {
    // 1. Unique truth id
    if (seenTruthIds.has(truth.id)) {
      errors.push(
        stateError(
          "TRUTH_DUPLICATE_ID",
          `investigationTruths: duplicate truth id "${truth.id}"`,
          { context: { id: truth.id } },
        ),
      );
    }
    seenTruthIds.add(truth.id);

    // 2. incidentId exists in investigationIncidents
    if (!investigationIncidentIds.has(truth.incidentId)) {
      errors.push(
        stateError(
          "TRUTH_ORPHAN_INCIDENT",
          `investigationTruths[${truth.id}]: incidentId "${truth.incidentId}" not found in investigationIncidents`,
          { context: { id: truth.id, incidentId: truth.incidentId } },
        ),
      );
    }

    // 3. At most one truth per incident
    if (seenIncidentIds.has(truth.incidentId)) {
      errors.push(
        stateError(
          "TRUTH_DUPLICATE_INCIDENT",
          `investigationTruths: two truths share incidentId "${truth.incidentId}"`,
          { context: { id: truth.id, incidentId: truth.incidentId } },
        ),
      );
    }
    seenIncidentIds.add(truth.incidentId);

    // 3b. Truth ↔ incident consistency
    const matchedIncident = incidentMap.get(truth.incidentId);
    if (matchedIncident !== undefined) {
      if (truth.eventFamily !== matchedIncident.eventFamily) {
        errors.push(
          stateError(
            "TRUTH_EVENTFAMILY_MISMATCH",
            `investigationTruths[${truth.id}]: eventFamily "${truth.eventFamily}" ≠ incident "${matchedIncident.eventFamily}"`,
            { context: { id: truth.id, incidentId: truth.incidentId } },
          ),
        );
      }
      if (truth.sourceKey !== matchedIncident.sourceKey) {
        errors.push(
          stateError(
            "TRUTH_SOURCEKEY_MISMATCH",
            `investigationTruths[${truth.id}]: sourceKey "${truth.sourceKey}" ≠ incident "${matchedIncident.sourceKey}"`,
            { context: { id: truth.id, incidentId: truth.incidentId } },
          ),
        );
      }
    }

    // 4. Culprit constraints by cause type
    const benignCauses = new Set(["natural_illness", "accident"]);
    const culpritRequiredCauses = new Set(["intentional_harm", "false_accusation"]);

    if (benignCauses.has(truth.causeType) && truth.culpritIds.length > 0) {
      errors.push(
        stateError(
          "TRUTH_INVALID_CULPRIT",
          `investigationTruths[${truth.id}]: causeType "${truth.causeType}" must have empty culpritIds`,
          { context: { id: truth.id, causeType: truth.causeType } },
        ),
      );
    }

    if (culpritRequiredCauses.has(truth.causeType) && truth.culpritIds.length === 0) {
      errors.push(
        stateError(
          "TRUTH_MISSING_CULPRIT",
          `investigationTruths[${truth.id}]: causeType "${truth.causeType}" must have non-empty culpritIds`,
          { context: { id: truth.id, causeType: truth.causeType } },
        ),
      );
    }

    // 4b. Framing constraints
    if (truth.causeType === "framing") {
      if (truth.culpritIds.length === 0) {
        errors.push(
          stateError(
            "TRUTH_MISSING_CULPRIT",
            `investigationTruths[${truth.id}]: causeType "framing" must have non-empty culpritIds`,
            { context: { id: truth.id, causeType: truth.causeType } },
          ),
        );
      }
      if (truth.framingTargetIds.length === 0) {
        errors.push(
          stateError(
            "TRUTH_MISSING_FRAMING_TARGET",
            `investigationTruths[${truth.id}]: causeType "framing" must have non-empty framingTargetIds`,
            { context: { id: truth.id, causeType: truth.causeType } },
          ),
        );
      }
      if (truth.accusedIds.length === 0) {
        errors.push(
          stateError(
            "TRUTH_MISSING_ACCUSED",
            `investigationTruths[${truth.id}]: causeType "framing" must have non-empty accusedIds`,
            { context: { id: truth.id, causeType: truth.causeType } },
          ),
        );
      }
      const culpritSet = new Set(truth.culpritIds);
      for (const targetId of truth.framingTargetIds) {
        if (culpritSet.has(targetId)) {
          errors.push(
            stateError(
              "TRUTH_CULPRIT_IS_FRAMING_TARGET",
              `investigationTruths[${truth.id}]: culprit "${targetId}" appears in framingTargetIds`,
              { context: { id: truth.id, charId: targetId } },
            ),
          );
        }
      }
    }

    // 4c. False accusation constraints
    if (truth.causeType === "false_accusation") {
      if (truth.accusedIds.length === 0) {
        errors.push(
          stateError(
            "TRUTH_MISSING_ACCUSED",
            `investigationTruths[${truth.id}]: causeType "false_accusation" must have non-empty accusedIds`,
            { context: { id: truth.id, causeType: truth.causeType } },
          ),
        );
      }
      const culpritSet = new Set(truth.culpritIds);
      for (const accusedId of truth.accusedIds) {
        if (culpritSet.has(accusedId)) {
          errors.push(
            stateError(
              "TRUTH_CULPRIT_IS_ACCUSED",
              `investigationTruths[${truth.id}]: culprit "${accusedId}" appears in accusedIds`,
              { context: { id: truth.id, charId: accusedId } },
            ),
          );
        }
      }
    }

    // 5. All character ids in culpritIds / accusedIds / framingTargetIds must exist
    for (const charId of [...truth.culpritIds, ...truth.accusedIds, ...truth.framingTargetIds]) {
      if (!allCharacterIds.has(charId)) {
        errors.push(
          stateError(
            "TRUTH_INVALID_CHARACTER",
            `investigationTruths[${truth.id}]: character id "${charId}" not found`,
            { context: { id: truth.id, charId } },
          ),
        );
      }
    }

    // 6. Evidence node ids unique within this truth
    const seenEvidenceIds = new Set<string>();
    for (const node of truth.evidenceNodes) {
      if (seenEvidenceIds.has(node.id)) {
        errors.push(
          stateError(
            "TRUTH_DUPLICATE_EVIDENCE",
            `investigationTruths[${truth.id}]: duplicate evidenceNode id "${node.id}"`,
            { context: { id: truth.id, nodeId: node.id } },
          ),
        );
      }
      seenEvidenceIds.add(node.id);

      // 6b. Evidence claim character refs must exist in allCharacterIds
      for (const claim of node.claims) {
        if (claim.kind === "implicates_character" || claim.kind === "exonerates_character") {
          if (!allCharacterIds.has(claim.characterRef)) {
            errors.push(
              stateError(
                "TRUTH_INVALID_CLAIM_CHARACTER",
                `investigationTruths[${truth.id}].evidenceNodes[${node.id}]: claim characterRef "${claim.characterRef}" not found`,
                { context: { id: truth.id, nodeId: node.id, charId: claim.characterRef } },
              ),
            );
          }
        }
      }
    }

    // 7. prerequisiteEvidenceIds must reference valid ids within the same truth
    for (const node of truth.evidenceNodes) {
      for (const prereqId of node.prerequisiteEvidenceIds) {
        if (!seenEvidenceIds.has(prereqId)) {
          errors.push(
            stateError(
              "TRUTH_INVALID_PREREQUISITE",
              `investigationTruths[${truth.id}].evidenceNodes[${node.id}]: prerequisite "${prereqId}" not found`,
              { context: { id: truth.id, nodeId: node.id, prereqId } },
            ),
          );
        }
      }
    }

    // 8. No dependency cycle in evidence nodes
    const prereqMap = new Map<string, string[]>();
    for (const node of truth.evidenceNodes) {
      prereqMap.set(node.id, node.prerequisiteEvidenceIds);
    }
    const visited = new Set<string>();
    const onStack = new Set<string>();
    for (const node of truth.evidenceNodes) {
      if (hasCycle(node.id, prereqMap, visited, onStack)) {
        errors.push(
          stateError(
            "TRUTH_EVIDENCE_CYCLE",
            `investigationTruths[${truth.id}]: evidence dependency cycle detected`,
            { context: { id: truth.id } },
          ),
        );
        break;
      }
    }

    // 9. method === "none" → causeType must be natural_illness or accident
    if (
      truth.method === "none" &&
      truth.causeType !== "natural_illness" &&
      truth.causeType !== "accident"
    ) {
      errors.push(
        stateError(
          "TRUTH_INVALID_METHOD",
          `investigationTruths[${truth.id}]: method "none" is only valid for natural_illness or accident, got "${truth.causeType}"`,
          { context: { id: truth.id, method: truth.method, causeType: truth.causeType } },
        ),
      );
    }
  }

  return errors;
}
