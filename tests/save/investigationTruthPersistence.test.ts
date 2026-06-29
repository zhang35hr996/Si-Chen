/**
 * Phase 5B-2A: InvestigationTruth save round-trip persistence tests.
 * Verifies investigationIncidents + investigationTruths survive
 * createSaveData → readSlot intact.
 */
import { describe, expect, it } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);

/**
 * Build a state using the base new-game standing (content characters, no integrity issues).
 * Augment household data for characters already in standing so candidate selection works.
 */
function makeStateWithCandidates(): GameState {
  // Start from the base state which already has content characters in standing.
  // Augment household data so buildHeirHealthTruthContext can compute access scores.
  const augmentedStanding = Object.fromEntries(
    Object.entries(base.standing).map(([id, st]) => [
      id,
      {
        ...st,
        ambition: st.ambition ?? 70,
        loyalty: st.loyalty ?? 30,
        personality: st.personality ?? {
          scheming: 70, sociability: 40, compassion: 20,
          courage: 60, jealousy: 70, emotionalStability: 30,
          pride: 40, intelligence: 55,
        },
        household: st.household ?? {
          servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40,
        },
      },
    ]),
  );
  return { ...base, standing: augmentedStanding };
}

const INCIDENT_PARAMS = {
  victimHeirId: "heir_001",
  accuserIds: [] as string[],
  initiallyAccusedIds: [] as string[],
  symptom: "hysteria" as const,
  publicFactCodes: ["heir_fell_ill"] as string[],
  victimHealth: 65,
};

describe("investigationTruth: save round-trip", () => {
  it("ITP-01: createHeirHealthAnomaly → createSaveData → readSlot → truth intact", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeStateWithCandidates());

    const r = store.createHeirHealthAnomaly(INCIDENT_PARAMS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { incidentId, truthId } = r.value;

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));

    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // investigationIncidents preserved
    const restoredIncident = loaded.value.state.investigationIncidents.find(
      (i) => i.id === incidentId,
    );
    expect(restoredIncident).toBeDefined();
    expect(restoredIncident?.victimHeirId).toBe("heir_001");
    expect(restoredIncident?.symptom).toBe("hysteria");
    expect(typeof restoredIncident?.sourceKey).toBe("string");

    // investigationTruths preserved
    const restoredTruth = loaded.value.state.investigationTruths.find((t) => t.id === truthId);
    expect(restoredTruth).toBeDefined();
    expect(restoredTruth?.incidentId).toBe(incidentId);
    expect([
      "natural_illness", "accident", "negligence",
      "intentional_harm", "framing", "false_accusation",
    ]).toContain(restoredTruth?.causeType);
    expect(restoredTruth?.evidenceNodes.length).toBeGreaterThan(0);
  });

  it("ITP-02: second call is idempotent — state has exactly 1 incident and 1 truth", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeStateWithCandidates());

    const r1 = store.createHeirHealthAnomaly(INCIDENT_PARAMS);
    const r2 = store.createHeirHealthAnomaly(INCIDENT_PARAMS);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r1.value.incidentId).toBe(r2.value.incidentId);
    expect(r1.value.truthId).toBe(r2.value.truthId);
    expect(store.getState().investigationIncidents).toHaveLength(1);
    expect(store.getState().investigationTruths).toHaveLength(1);

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationIncidents).toHaveLength(1);
    expect(loaded.value.state.investigationTruths).toHaveLength(1);
  });

  it("ITP-03: evidence nodes have unique IDs after round-trip", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeStateWithCandidates());

    const r = store.createHeirHealthAnomaly(INCIDENT_PARAMS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const restored = loaded.value.state.investigationTruths[0]!;
    const ids = restored.evidenceNodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ITP-04: different victimHeirId → different incidentId (sourceKey derived internally)", () => {
    const store = createGameStore();
    store.loadState(makeStateWithCandidates());

    const r1 = store.createHeirHealthAnomaly({ ...INCIDENT_PARAMS, victimHeirId: "heir_001" });
    const r2 = store.createHeirHealthAnomaly({ ...INCIDENT_PARAMS, victimHeirId: "heir_002" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r1.value.incidentId).not.toBe(r2.value.incidentId);
    expect(r1.value.truthId).not.toBe(r2.value.truthId);
    expect(store.getState().investigationIncidents).toHaveLength(2);
    expect(store.getState().investigationTruths).toHaveLength(2);
  });
});
