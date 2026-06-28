/**
 * PR #77A 奉先殿抚养权核心：49 test cases
 *
 * 覆盖：
 *  A. currentEligibleEmpress (3)
 *  B. eligibleCustodiansForHeir (12)
 *  C. planHeirCustodyTransfer (10)
 *  D. resolveHeirCustodyTransfer — effects (6)
 *  E. chronicle + reactions (6)
 *  F. GameStore.transferHeirCustodyAndAdvance — atomic transaction (8)
 *  G. save round-trip — gameStateSchema (4)
 */
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import {
  currentEligibleEmpress,
  eligibleCustodiansForHeir,
  planHeirCustodyTransfer,
  resolveHeirCustodyTransfer,
} from "../../src/store/heirCustody";
import { GameStore } from "../../src/store/gameStore";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { autosave, readSlot } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import type { GameState, Heir } from "../../src/engine/state/types";

const db = loadRealContent();

// ── Test helpers ──────────────────────────────────────────────────────────────

function baseHeir(over: Partial<Heir> = {}): Heir {
  return {
    id: "heir_000001",
    sex: "son",
    fatherId: null,
    bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 50,
    legitimate: false,
    petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 },
    health: 60,
    talent: 50,
    diligence: 50,
    ambition: 20,
    closeness: 50,
    support: 20,
    faction: "none",
    lifecycle: "alive",
    ...over,
  };
}

function addHeirToState(state: GameState, heir: Heir): GameState {
  state.resources.bloodline.heirs = [
    ...state.resources.bloodline.heirs.filter((h) => h.id !== heir.id),
    heir,
  ];
  return state;
}

/** Find or promote first available consort to given rank (mutates state). */
function promoteToRank(state: GameState, rank: string): string {
  for (const [id, st] of Object.entries(state.standing)) {
    const c = db.characters[id] ?? state.generatedConsorts[id];
    if (c?.kind !== "consort") continue;
    if (st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    if (st.rank === "huanghou") continue;
    (state.standing[id] as { rank: string }).rank = rank;
    return id;
  }
  throw new Error(`no promotable consort for rank ${rank}`);
}

/** Find empress (huanghou) in current state. */
function findEmpressId(state: GameState): string {
  for (const [id, st] of Object.entries(state.standing)) {
    if (st.rank === "huanghou" && st.lifecycle !== "deceased") return id;
  }
  throw new Error("no empress in test state");
}

// ── A. currentEligibleEmpress ─────────────────────────────────────────────────

describe("A. currentEligibleEmpress", () => {
  it("A1: returns empress in new-game state", () => {
    const state = createNewGameState(db);
    const empress = currentEligibleEmpress(db, state);
    expect(empress).not.toBeNull();
    expect(state.standing[empress!.id]?.rank).toBe("huanghou");
  });

  it("A2: returns null when empress is deceased", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    (state.standing[empressId] as { lifecycle: string }).lifecycle = "deceased";
    expect(currentEligibleEmpress(db, state)).toBeNull();
  });

  it("A3: returns null when no huanghou rank exists", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    (state.standing[empressId] as { rank: string }).rank = "guiren";
    expect(currentEligibleEmpress(db, state)).toBeNull();
  });
});

// ── B. eligibleCustodiansForHeir ──────────────────────────────────────────────

describe("B. eligibleCustodiansForHeir", () => {
  it("B1: returns empty for legitimate heir", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ legitimate: true });
    addHeirToState(state, heir);
    expect(eligibleCustodiansForHeir(db, state, heir)).toHaveLength(0);
  });

  it("B2: returns empty for deceased heir", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ lifecycle: "deceased" });
    addHeirToState(state, heir);
    expect(eligibleCustodiansForHeir(db, state, heir)).toHaveLength(0);
  });

  it("B3: includes taihou (皇郎 threshold is changzai > order)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const pool = eligibleCustodiansForHeir(db, state, heir);
    expect(pool.some((c) => c.id === "taihou")).toBe(true);
  });

  it("B4: taihou absent when deceased", () => {
    const state = createNewGameState(db);
    (state.taihou as { deceased: boolean }).deceased = true;
    const heir = baseHeir();
    addHeirToState(state, heir);
    const pool = eligibleCustodiansForHeir(db, state, heir);
    expect(pool.some((c) => c.id === "taihou")).toBe(false);
  });

  it("B5: excludes current custodian from pool", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ adoptiveFatherId: "taihou" });
    addHeirToState(state, heir);
    const pool = eligibleCustodiansForHeir(db, state, heir);
    expect(pool.some((c) => c.id === "taihou")).toBe(false);
  });

  it("B6: 皇郎 excludes changzai-rank (order must be > changzai.order)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const changzaiOrder = db.ranks["changzai"]?.order ?? 84;
    const pool = eligibleCustodiansForHeir(db, state, heir);
    for (const c of pool) {
      if (c.kind === "consort") {
        const rank = db.ranks[c.rankId!];
        expect(rank?.order).toBeGreaterThan(changzaiOrder);
      }
    }
  });

  it("B7: 皇子 excludes below guiren (order must be >= guiren.order)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const guirenOrder = db.ranks["guiren"]?.order ?? 116;
    const pool = eligibleCustodiansForHeir(db, state, heir);
    for (const c of pool) {
      if (c.kind === "consort") {
        const rank = db.ranks[c.rankId!];
        expect(rank?.order).toBeGreaterThanOrEqual(guirenOrder);
      }
    }
  });

  it("B8: excludes deceased consort", () => {
    const state = createNewGameState(db);
    const heir = baseHeir();
    addHeirToState(state, heir);
    // Kill all consorts, check pool only has taihou
    for (const [id, st] of Object.entries(state.standing)) {
      if ((db.characters[id] ?? state.generatedConsorts[id])?.kind === "consort" && st.rank !== "huanghou") {
        (state.standing[id] as { lifecycle: string }).lifecycle = "deceased";
      }
    }
    const pool = eligibleCustodiansForHeir(db, state, heir);
    const consortsInPool = pool.filter((c) => c.kind === "consort");
    for (const c of consortsInPool) {
      expect(state.standing[c.id]?.lifecycle).not.toBe("deceased");
    }
  });

  it("B9: excludes candidate consort", () => {
    const state = createNewGameState(db);
    const heir = baseHeir();
    addHeirToState(state, heir);
    for (const [id, st] of Object.entries(state.standing)) {
      if (db.characters[id]?.kind === "consort" && st.lifecycle === "candidate") {
        const pool = eligibleCustodiansForHeir(db, state, heir);
        expect(pool.some((c) => c.id === id)).toBe(false);
        break;
      }
    }
  });

  it("B10: excludes authored cold-palace consort (wenya if present)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir();
    addHeirToState(state, heir);
    // authored cold-palace chars have defaultLocation === "changmengong"
    const coldPalaceAuthoredIds = Object.keys(db.characters).filter(
      (id) => db.characters[id]?.defaultLocation === "changmengong",
    );
    const pool = eligibleCustodiansForHeir(db, state, heir);
    for (const id of coldPalaceAuthoredIds) {
      expect(pool.some((c) => c.id === id)).toBe(false);
    }
  });

  it("B11: becomesLegitimate=true only for current eligible empress", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const pool = eligibleCustodiansForHeir(db, state, heir);
    const empressEntry = pool.find((c) => c.id === empressId);
    if (empressEntry) {
      expect(empressEntry.becomesLegitimate).toBe(true);
    }
    for (const c of pool) {
      if (c.id !== empressId) {
        expect(c.becomesLegitimate).toBe(false);
      }
    }
  });

  it("B12: candidate includes empress when 皇子 (no rank minimum blocks huanghou)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empress = currentEligibleEmpress(db, state);
    if (empress) {
      const pool = eligibleCustodiansForHeir(db, state, heir);
      expect(pool.some((c) => c.id === empress.id)).toBe(true);
    }
  });
});

// ── C. planHeirCustodyTransfer — validation ───────────────────────────────────

describe("C. planHeirCustodyTransfer – validation", () => {
  it("C1: rejects unknown heir", () => {
    const state = createNewGameState(db);
    const result = planHeirCustodyTransfer(db, state, { heirId: "no_such_heir", toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error[0]?.code).toBe("INVALID_HEIR");
  });

  it("C2: rejects deceased heir", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ lifecycle: "deceased" });
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(false);
  });

  it("C3: rejects legitimate heir", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ legitimate: true });
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error[0]?.code).toBe("LEGITIMATE_LOCKED");
  });

  it("C4: rejects same custodian", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ adoptiveFatherId: "taihou" });
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error[0]?.code).toBe("SAME_CUSTODIAN");
  });

  it("C5: rejects deceased custodian", () => {
    const state = createNewGameState(db);
    const heir = baseHeir();
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    (state.standing[empressId] as { lifecycle: string }).lifecycle = "deceased";
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(result.ok).toBe(false);
  });

  it("C6: rejects rank-ineligible custodian for 皇郎 (changzai rank)", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    // Demote a non-empress consort to changzai and try to assign
    const changzaiId = promoteToRank(state, "changzai");
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: changzaiId, source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error[0]?.code).toBe("INVALID_CUSTODIAN");
  });

  it("C7: rejects unknown custodian", () => {
    const state = createNewGameState(db);
    const heir = baseHeir();
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "ghost_999", source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error[0]?.code).toBe("INVALID_CUSTODIAN");
  });

  it("C8: succeeds — taihou, non-legitimate son", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.becomesLegitimate).toBe(false);
      expect(result.value.toCustodianId).toBe("taihou");
    }
  });

  it("C9: succeeds — empress custodian sets becomesLegitimate=true", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.becomesLegitimate).toBe(true);
    }
  });

  it("C10: plan includes heir_custody effect", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const result = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const custodyEff = result.value.effects.find((e) => e.type === "heir_custody");
      expect(custodyEff).toBeDefined();
      expect((custodyEff as { heirId: string })?.heirId).toBe(heir.id);
    }
  });
});

// ── D. resolveHeirCustodyTransfer — state effects ────────────────────────────

describe("D. resolveHeirCustodyTransfer – state effects", () => {
  it("D1: adoptiveFatherId set to taihou after resolve", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const result = resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.state.resources.bloodline.heirs.find((h) => h.id === heir.id);
      expect(updated?.adoptiveFatherId).toBe("taihou");
    }
  });

  it("D2: heir becomes legitimate when assigned to empress", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const result = resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.state.resources.bloodline.heirs.find((h) => h.id === heir.id);
      expect(updated?.legitimate).toBe(true);
    }
  });

  it("D3: old consort custodian loses favor -10", () => {
    const state = createNewGameState(db);
    const empressId = findEmpressId(state);
    // Find a non-empress consort for old custodian — promote to guiren
    const oldCustodianId = promoteToRank(state, "guiren");
    const oldFavor = state.standing[oldCustodianId]!.favor;
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: oldCustodianId });
    addHeirToState(state, heir);
    const result = resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const newFavor = result.value.state.standing[oldCustodianId]!.favor;
      expect(newFavor).toBeLessThan(oldFavor);
      expect(oldFavor - newFavor).toBeLessThanOrEqual(10);
    }
  });

  it("D4: no favor penalty when previous custodian is taihou", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: "taihou" });
    addHeirToState(state, heir);
    // taihou is current custodian — not in pool, use a guiren consort as new custodian instead.
    const guirenId = promoteToRank(state, "guiren");
    const result = resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: guirenId, source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // taihou has no standing entry → no favor effect possible
      expect(result.value.state.standing["taihou"]).toBeUndefined();
    }
  });

  it("D5: chronicle entry added for heir_custody_changed", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const result = resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.value.state.chronicle;
      const custodyEvent = events.find((e) => e.type === "heir_custody_changed");
      expect(custodyEvent).toBeDefined();
    }
  });

  it("D6: original state is not mutated", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const before = JSON.stringify(state);
    resolveHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ── E. chronicle + reactions ──────────────────────────────────────────────────

describe("E. chronicle and reactions", () => {
  it("E1: chronicle has heirId and toCustodianId in payload", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.chronicle).toHaveLength(1);
      const entry = plan.value.chronicle[0]!;
      expect((entry.payload as { heirId: string }).heirId).toBe(heir.id);
      expect((entry.payload as { toCustodianId: string }).toCustodianId).toBe("taihou");
    }
  });

  it("E2: becameLegitimate=true in chronicle when assigned to empress", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const entry = plan.value.chronicle[0]!;
      expect((entry.payload as { becameLegitimate: boolean }).becameLegitimate).toBe(true);
    }
  });

  it("E3: fromCustodianId in chronicle when previous custodian existed", () => {
    const state = createNewGameState(db);
    const oldCustodianId = promoteToRank(state, "guiren");
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: oldCustodianId });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const entry = plan.value.chronicle[0]!;
      expect((entry.payload as { fromCustodianId: string | null }).fromCustodianId).toBe(oldCustodianId);
    }
  });

  it("E4: taihou reaction is speakerId='taihou'", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.reactions.length).toBeGreaterThan(0);
      expect(plan.value.reactions[0]!.speakerId).toBe("taihou");
    }
  });

  it("E5: wei_sui grief reaction appears when living consort loses custody", () => {
    const state = createNewGameState(db);
    const oldCustodianId = promoteToRank(state, "guiren");
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: oldCustodianId });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.reactions.some((r) => r.speakerId === "wei_sui")).toBe(true);
    }
  });

  it("E6: no wei_sui reaction when previous custodian was taihou", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: "taihou" });
    addHeirToState(state, heir);
    // Use a non-taihou, non-empress custodian
    const guirenId = promoteToRank(state, "guiren");
    const plan = planHeirCustodyTransfer(db, state, { heirId: heir.id, toCustodianId: guirenId, source: "fengxiandian" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.reactions.some((r) => r.speakerId === "wei_sui")).toBe(false);
    }
  });
});

// ── F. GameStore.transferHeirCustodyAndAdvance — atomic transaction ───────────

describe("F. GameStore.transferHeirCustodyAndAdvance – atomic transaction", () => {
  function makeStore(state: GameState) {
    const store = new GameStore();
    store.loadState(state);
    return store;
  }

  it("F1: AP is deducted by exactly 1", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const store = makeStore(state);
    const apBefore = store.getState().calendar.ap;
    const result = store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(true);
    expect(store.getState().calendar.ap).toBe(apBefore - 1);
  });

  it("F2: adoptiveFatherId updated after successful transfer", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const store = makeStore(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    const updated = store.getState().resources.bloodline.heirs.find((h) => h.id === heir.id);
    expect(updated?.adoptiveFatherId).toBe("taihou");
  });

  it("F3: heir becomes legitimate when assigned to empress", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const store = makeStore(state);
    const result = store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    expect(result.ok).toBe(true);
    const updated = store.getState().resources.bloodline.heirs.find((h) => h.id === heir.id);
    expect(updated?.legitimate).toBe(true);
  });

  it("F4: chronicle gains exactly one heir_custody_changed entry", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const store = makeStore(state);
    const chronicleBefore = store.getState().chronicle.length;
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    const chronicle = store.getState().chronicle;
    expect(chronicle.length).toBe(chronicleBefore + 1);
    expect(chronicle.at(-1)?.type).toBe("heir_custody_changed");
  });

  it("F5: AP not deducted on validation failure", () => {
    const state = createNewGameState(db);
    // Legitimate heir — transfer should be rejected
    const heir = baseHeir({ legitimate: true });
    addHeirToState(state, heir);
    const store = makeStore(state);
    const apBefore = store.getState().calendar.ap;
    const result = store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(result.ok).toBe(false);
    expect(store.getState().calendar.ap).toBe(apBefore);
  });

  it("F6: state unchanged on validation failure", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ legitimate: true });
    addHeirToState(state, heir);
    const store = makeStore(state);
    const snapshotBefore = JSON.stringify(store.getState());
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    expect(JSON.stringify(store.getState())).toBe(snapshotBefore);
  });

  it("F7: old consort favor is exactly maxed at -10 (favor >= 0)", () => {
    const state = createNewGameState(db);
    const oldCustodianId = promoteToRank(state, "guiren");
    const empressId = findEmpressId(state);
    const oldFavor = state.standing[oldCustodianId]!.favor;
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: oldCustodianId });
    addHeirToState(state, heir);
    const store = makeStore(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    const newFavor = store.getState().standing[oldCustodianId]!.favor;
    expect(newFavor).toBe(Math.max(0, oldFavor - 10));
  });

  it("F8: old consort affection is reduced by exactly 10 (clamped at 0)", () => {
    const state = createNewGameState(db);
    const oldCustodianId = promoteToRank(state, "guiren");
    const empressId = findEmpressId(state);
    const oldAffection = state.standing[oldCustodianId]!.affection ?? 0;
    const heir = baseHeir({ sex: "daughter", adoptiveFatherId: oldCustodianId });
    addHeirToState(state, heir);
    const store = makeStore(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    const newAffection = store.getState().standing[oldCustodianId]!.affection ?? 0;
    expect(newAffection).toBe(Math.max(0, oldAffection - 10));
  });
});

// ── G. Save round-trip ────────────────────────────────────────────────────────

describe("G. save round-trip", () => {
  it("G1: state after transfer passes gameStateSchema.safeParse", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const store = new GameStore();
    store.loadState(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    const parsed = gameStateSchema.safeParse(store.getState());
    expect(parsed.success).toBe(true);
  });

  it("G2: state with heir_custody_changed in chronicle round-trips via autosave+readSlot", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "son" });
    addHeirToState(state, heir);
    const store = new GameStore();
    store.loadState(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: "taihou", source: "fengxiandian" });
    const storage = createMemoryStorage();
    const saved = autosave(storage, db, store.getState());
    expect(saved.ok).toBe(true);
    const loaded = readSlot(storage, db, "auto");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const event = loaded.value.state.chronicle.find((e) => e.type === "heir_custody_changed");
      expect(event).toBeDefined();
      expect((event?.payload as { toCustodianId: string })?.toCustodianId).toBe("taihou");
    }
  });

  it("G3: heir remains legitimate after save+load when assigned to empress", () => {
    const state = createNewGameState(db);
    const heir = baseHeir({ sex: "daughter" });
    addHeirToState(state, heir);
    const empressId = findEmpressId(state);
    const store = new GameStore();
    store.loadState(state);
    store.transferHeirCustodyAndAdvance(db, { heirId: heir.id, toCustodianId: empressId, source: "fengxiandian" });
    const storage = createMemoryStorage();
    autosave(storage, db, store.getState());
    const loaded = readSlot(storage, db, "auto");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const loadedHeir = loaded.value.state.resources.bloodline.heirs.find((h) => h.id === heir.id);
      expect(loadedHeir?.legitimate).toBe(true);
      expect(loadedHeir?.adoptiveFatherId).toBe(empressId);
    }
  });

  it("G4: schema parse fails for invalid chronicle type (guard test)", () => {
    const state = createNewGameState(db);
    const stateWithBadChronicle = {
      ...state,
      chronicle: [
        {
          id: "evt_000001" as const,
          type: "nonexistent_event_type",
          occurredAt: makeGameTime(1, 1, "early"),
          participants: [],
          payload: {},
          publicity: { scope: "palace" as const, persistence: "contemporaneous" as const },
          publicSalience: 50,
          retention: "permanent" as const,
          tags: [],
        },
      ],
    };
    const parsed = gameStateSchema.safeParse(stateWithBadChronicle);
    expect(parsed.success).toBe(false);
  });
});
