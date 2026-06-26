/** store 奏折批阅命令 + 年度灾情生产 seam + v19→v20 迁移（Phase 4A）+ 财政奏折 store 命令（Group F, Phase 4B）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import {
  generateDisasterMemorial,
  generateTreasuryMemorial,
  getPendingMemorials,
  validateMemorials,
} from "../../src/engine/court/memorials";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf, toGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("store.resolveMemorial", () => {
  it("emits once on success and applies the option effect through the funnel", () => {
    const store = new GameStore();
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "major", toGameTime(createNewGameState(db, 1).calendar))!;
    store.loadState(g.state);
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const before = store.getState().resources.nation.publicSupport;
    const r = store.resolveMemorial(db, g.memorial.id, "relief");
    expect(r.ok).toBe(true);
    expect(emits).toBe(1);
    expect(store.getState().resources.nation.publicSupport).toBeGreaterThan(before);
    expect(store.getState().memorials[g.memorial.id]!.status).toBe("resolved");
  });

  it("does not emit and leaves state unchanged on a bad option", () => {
    const store = new GameStore();
    const g = generateDisasterMemorial(createNewGameState(db, 1), "jiangnan", "minor", toGameTime(createNewGameState(db, 1).calendar))!;
    store.loadState(g.state);
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const snap = JSON.stringify(store.getState());
    const r = store.resolveMemorial(db, g.memorial.id, "nope");
    expect(r.ok).toBe(false);
    expect(emits).toBe(0);
    expect(JSON.stringify(store.getState())).toBe(snap);
  });
});

describe("annual disaster seam (production-reachable)", () => {
  it("crossing into a new year generates a disaster memorial; idempotent within the year", () => {
    const store = new GameStore();
    const s = createNewGameState(db, 1);
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 12, period: "late", dayIndex: dayIndexOf(1, 12, "late"), ap: 1 } });
    expect(getPendingMemorials(store.getState())).toHaveLength(0);

    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.year).toBe(2);
    expect(store.getState().calendar.month).toBe(1);
    const pending = getPendingMemorials(store.getState());
    expect(pending.length).toBe(1); // seam 真实可达
    expect(pending[0]!.category).toBe("disaster");
    expect(validateMemorials(store.getState())).toEqual([]);

    const countAfter = Object.keys(store.getState().memorials).length;
    store.advanceTime(db, { type: "SKIP_REMAINDER" }); // 同年再推进
    expect(Object.keys(store.getState().memorials).length).toBe(countAfter); // 不重复
  });

  it("the generated disaster memorial is resolvable through the store", () => {
    const store = new GameStore();
    const s = createNewGameState(db, 1);
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 12, period: "late", dayIndex: dayIndexOf(1, 12, "late"), ap: 1 } });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    const m = getPendingMemorials(store.getState())[0]!;
    const r = store.resolveMemorial(db, m.id, "relief");
    expect(r.ok).toBe(true);
    expect(store.getState().memorials[m.id]!.status).toBe("resolved");
  });
});

describe("save migration v19 → v20 (memorials backfill)", () => {
  it("SAVE_FORMAT_VERSION ≥ 20", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(20);
  });

  function makeV19Save(): string {
    const s = createNewGameState(db);
    const stateV19 = { ...s } as Record<string, unknown>;
    delete stateV19.memorials;
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 19, state: stateV19, checksum: checksumOf(stateV19 as unknown as GameState) };
    return JSON.stringify(env);
  }

  it("v19 save without memorials migrates to v20 with an empty record", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV19Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.memorials).toEqual({});
  });
});

// ── Group F: store 财政奏折命令（Phase 4B）────────────────────────────────────

describe("Group F: store.resolveMemorial — treasury memorial", () => {
  const AT_APRIL = { year: 2, month: 4, period: "early" as const, dayIndex: dayIndexOf(2, 4, "early") };

  function storeWithTreasuryMemorial(treasury = 10000): { store: GameStore; memId: string } {
    const store = new GameStore();
    const base = createNewGameState(db, 1);
    const stateWithBalance: GameState = {
      ...base,
      resources: { ...base.resources, nation: { ...base.resources.nation, treasury } },
    };
    const gen = generateTreasuryMemorial(stateWithBalance, AT_APRIL)!;
    store.loadState(gen.state);
    return { store, memId: gen.memorial.id };
  }

  it("treasury resolve audit: emits 1, treasury increases, ledger written", () => {
    const { store, memId } = storeWithTreasuryMemorial();
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const before = store.getState().resources.nation.treasury;

    const r = store.resolveMemorial(db, memId, "audit");
    expect(r.ok).toBe(true);
    expect(emits).toBe(1);
    expect(store.getState().resources.nation.treasury).toBeGreaterThan(before);
    expect(store.getState().treasuryLedger).toHaveLength(1);
    expect(store.getState().memorials[memId]!.status).toBe("resolved");
  });

  it("treasury resolve surtax: emits 1, treasury increases", () => {
    const { store, memId } = storeWithTreasuryMemorial();
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const before = store.getState().resources.nation.treasury;

    const r = store.resolveMemorial(db, memId, "surtax");
    expect(r.ok).toBe(true);
    expect(emits).toBe(1);
    expect(store.getState().resources.nation.treasury).toBeGreaterThan(before);
  });

  it("treasury resolve defer: emits 1, no ledger entry (no treasury change)", () => {
    const { store, memId } = storeWithTreasuryMemorial();
    let emits = 0;
    store.subscribe(() => { emits += 1; });

    const r = store.resolveMemorial(db, memId, "defer");
    expect(r.ok).toBe(true);
    expect(emits).toBe(1);
    expect(store.getState().treasuryLedger).toHaveLength(0);
  });

  it("failure on bad option: emits 0, state unchanged", () => {
    const { store, memId } = storeWithTreasuryMemorial();
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const snap = JSON.stringify(store.getState());

    const r = store.resolveMemorial(db, memId, "nonexistent");
    expect(r.ok).toBe(false);
    expect(emits).toBe(0);
    expect(JSON.stringify(store.getState())).toBe(snap);
  });

  // Coverage note: the top-level "store.resolveMemorial" disaster test already verifies emit-on-success
  // for the same underlying method. This test explicitly documents that the treasury resolution path also
  // triggers the autosave subscriber (onCommitted equivalent) on success.
  it("onCommitted fires on treasury resolve success (emit triggers autosave subscriber)", () => {
    const { store, memId } = storeWithTreasuryMemorial();
    let callCount = 0;
    store.subscribe(() => { callCount += 1; });
    const r = store.resolveMemorial(db, memId, "defer");
    expect(r.ok).toBe(true);
    expect(callCount).toBe(1); // emit() fires exactly once → autosave subscriber is triggered
  });
});
