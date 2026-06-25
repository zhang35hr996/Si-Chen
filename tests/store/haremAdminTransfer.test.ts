/**
 * Tests for PUNISH-3A harem administration transfer (planHaremAdministrationTransfer).
 * 17 tests covering: validation, classification, chronicle, effects.
 */
import { describe, expect, it } from "vitest";
import { planHaremAdministrationTransfer } from "../../src/store/haremAdminTransfer";
import { eligibleHaremAdministrators } from "../../src/engine/characters/haremAdministration";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

function makeStore() {
  const state = createNewGameState(db);
  const store = new GameStore();
  store.loadState(state);
  return store;
}

/** Find the empress id in a state (fenghou rank, alive). */
function findEmpressId(state: GameState): string {
  for (const [id, st] of Object.entries(state.standing)) {
    if (st.rank === "fenghou" && st.lifecycle !== "deceased") return id;
  }
  throw new Error("no empress in test state");
}

/**
 * Finds first eligible administrator candidate (rank >= fu, not confined, not cold palace).
 * Promotes a consort to "fu" if no eligible candidate exists in the fixture.
 */
function findOrMakeEligibleConsortId(state: GameState): string {
  const eligible = eligibleHaremAdministrators(db, state);
  if (eligible.length > 0) return eligible[0]!.id;
  // Promote the first non-empress alive consort to "fu" (满足 harem admin 门槛)
  for (const [id, st] of Object.entries(state.standing)) {
    const char = db.characters[id];
    if (char?.kind === "consort" && st.rank !== "fenghou" && st.lifecycle !== "deceased" && st.lifecycle !== "candidate") {
      state.standing[id]!.rank = "fu" as (typeof st)["rank"];
      return id;
    }
  }
  throw new Error("no consort in test state to promote");
}

// ── 1. No-op rejection ────────────────────────────────────────────────────────

describe("planHaremAdministrationTransfer – no-op rejection", () => {
  it("1. rejects empress→empress (already managing)", () => {
    const state = createNewGameState(db);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "empress" },
    });
    expect(result.ok).toBe(false);
  });

  it("2. rejects acting→same consort", () => {
    const state = createNewGameState(db);
    const consortId = findOrMakeEligibleConsortId(state);
    // Pre-set acting_consort mode.
    state.haremAdministration = {
      mode: "acting_consort",
      charId: consortId,
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      reason: "empress_confined",
    };
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(false);
  });

  it("3. rejects neiwu_proxy→neiwu_proxy", () => {
    const state = createNewGameState(db);
    state.haremAdministration = {
      mode: "neiwu_proxy",
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      reason: "no_eligible_consort",
    };
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "neiwu_proxy" },
    });
    expect(result.ok).toBe(false);
  });
});

// ── 2. Target validation ──────────────────────────────────────────────────────

describe("planHaremAdministrationTransfer – target validation", () => {
  it("4. rejects ineligible consort target (deceased)", () => {
    const state = createNewGameState(db);
    const consortId = findOrMakeEligibleConsortId(state);
    state.standing[consortId]!.lifecycle = "deceased";
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(false);
  });

  it("5. rejects ineligible consort target (cold palace / changmengong)", () => {
    const state = createNewGameState(db);
    const consortId = findOrMakeEligibleConsortId(state);
    // Cold palace = residence set to changmengong (not a lifecycle value)
    state.standing[consortId]!.residence = "changmengong";
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(false);
  });
});

// ── 3. Punitive classification (healthy empress → other) ─────────────────────

describe("planHaremAdministrationTransfer – punitive (healthy empress→other)", () => {
  it("6. healthy empress → consort: isPunitive=true, reason=imperial_deprivation", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "healthy";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(true);
    const chronicle = result.plan.chronicle[0];
    expect(chronicle?.payload).toMatchObject({ reason: "imperial_deprivation" });
  });

  it("7. punitive: set_harem_administration effect is present with mode=acting_consort", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "healthy";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const adminEffect = result.plan.effects.find((e) => e.type === "set_harem_administration");
    expect(adminEffect).toBeDefined();
    expect((adminEffect as { state: { mode: string } })?.state.mode).toBe("acting_consort");
  });

  it("8. punitive: empress gets trauma memory", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "healthy";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memEffect = result.plan.effects.find((e) => e.type === "memory" && (e as { char: string }).char === empressId);
    expect(memEffect).toBeDefined();
    expect((memEffect as { entry: { kind: string } })?.entry.kind).toBe("trauma");
  });

  it("9. punitive via GameStore: punishmentId returned and chronicle contains it", () => {
    const store = makeStore();
    const state = store.getState();
    const empressId = findEmpressId(state);
    // Mutate directly (getState returns reference to internal state)
    state.standing[empressId]!.healthStatus = "healthy";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = store.transferHaremAdministration(db, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toMatch(/^pun_\d{6}$/);
    // Chronicle should contain the punishmentId
    const chronicle = store.getState().chronicle;
    const entry = chronicle.find((e) => (e.payload as { punishmentId?: string }).punishmentId === result.value.punishmentId);
    expect(entry).toBeDefined();
  });
});

// ── 4. Administrative (sick/critical empress) ─────────────────────────────────

describe("planHaremAdministrationTransfer – administrative (sick/critical empress)", () => {
  it("10. sick empress → consort: isPunitive=false, reason=empress_illness", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "sick";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(false);
    const chronicle = result.plan.chronicle[0];
    expect(chronicle?.payload).toMatchObject({ reason: "empress_illness" });
  });

  it("11. critical empress → consort: isPunitive=false", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "critical";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(false);
  });

  it("12. administrative: empress gets episodic (not trauma) memory", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "sick";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memEffect = result.plan.effects.find((e) => e.type === "memory" && (e as { char: string }).char === empressId);
    expect(memEffect).toBeDefined();
    expect((memEffect as { entry: { kind: string } })?.entry.kind).toBe("episodic");
  });

  it("13. administrative via GameStore: punishmentId is undefined, state changes", () => {
    const store = makeStore();
    const state = store.getState();
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "sick";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = store.transferHaremAdministration(db, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.punishmentId).toBeUndefined();
    expect(store.getState().haremAdministration.mode).toBe("acting_consort");
  });
});

// ── 5. Restoration ────────────────────────────────────────────────────────────

describe("planHaremAdministrationTransfer – restoration", () => {
  it("14. acting → empress: success, no punishment, mode becomes empress", () => {
    const state = createNewGameState(db);
    const consortId = findOrMakeEligibleConsortId(state);
    state.haremAdministration = {
      mode: "acting_consort",
      charId: consortId,
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      reason: "imperial_deprivation",
    };
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "empress" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(false);
    const adminEffect = result.plan.effects.find((e) => e.type === "set_harem_administration");
    expect((adminEffect as { state: { mode: string } })?.state.mode).toBe("empress");
  });

  it("15. neiwu_proxy → empress: success", () => {
    const state = createNewGameState(db);
    state.haremAdministration = {
      mode: "neiwu_proxy",
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      reason: "no_eligible_consort",
    };
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "empress" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(false);
  });
});

// ── 6. Reassignment ────────────────────────────────────────────────────────────

describe("planHaremAdministrationTransfer – reassignment", () => {
  it("16. acting A → acting B: isPunitive=false, reason=imperial_reassignment", () => {
    const state = createNewGameState(db);
    // Find or create two eligible consorts by promoting to "fu"
    const nonEmpress = Object.keys(state.standing).filter((id) => {
      const char = db.characters[id];
      const st = state.standing[id];
      return char?.kind === "consort" && st?.rank !== "fenghou" && st?.lifecycle !== "deceased" && st?.lifecycle !== "candidate";
    });
    if (nonEmpress.length < 2) return; // skip if fixture doesn't have two
    const [consort1, consort2] = nonEmpress as [string, string];
    // Ensure both meet eligibility: promote rank and move out of cold palace.
    state.standing[consort1]!.rank = "fu" as (typeof state.standing[typeof consort1])["rank"];
    state.standing[consort1]!.residence = "kunninggong";
    state.standing[consort2]!.rank = "fu" as (typeof state.standing[typeof consort2])["rank"];
    state.standing[consort2]!.residence = "kunninggong";
    state.haremAdministration = {
      mode: "acting_consort",
      charId: consort1,
      appointedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      reason: "imperial_deprivation",
    };
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consort2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.isPunitive).toBe(false);
    const chronicle = result.plan.chronicle[0];
    expect(chronicle?.payload).toMatchObject({ reason: "imperial_reassignment" });
  });

  it("17. acting consort gets memory when appointed as new acting admin", () => {
    const state = createNewGameState(db);
    // Set empress to sick so it's an administrative transfer (still appends acting consort memory)
    const empressId = findEmpressId(state);
    state.standing[empressId]!.healthStatus = "sick";
    const consortId = findOrMakeEligibleConsortId(state);
    const result = planHaremAdministrationTransfer(db, state, {
      type: "transfer_harem_administration",
      target: { kind: "consort", charId: consortId },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actingMemory = result.plan.effects.find(
      (e) => e.type === "memory" && (e as { char: string }).char === consortId,
    );
    expect(actingMemory).toBeDefined();
  });
});
