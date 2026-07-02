/** store 人事决策裁断命令 + 人事决策集合 v17→v18 迁移（Phase 3 PR3C-3b）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { generateConsortPetition, generateMemorial } from "../../src/engine/officials/personnelDecisions";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState, Official } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const LU_CONSORT = "lu_huaijin";
const WEN_OFFICIAL = "official_fam_wen_main";
const tune = (s: GameState, id: string, p: Partial<Official["reviewState"]>): GameState => {
  const o = s.officials[id]!;
  return { ...s, officials: { ...s.officials, [id]: { ...o, reviewState: { ...o.reviewState, ...p } } } };
};

describe("store resolvePersonnelDecision", () => {
  it("approving a petition emits once, promotes administratively, returns no punishmentId", () => {
    const store = new GameStore();
    const base = withConsort(createNewGameState(db, 1), db, "lu_huaijin");
    const g = generateConsortPetition(base, db, LU_CONSORT, toGameTime(base.calendar))!;
    store.loadState(g.state);
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const r = store.resolvePersonnelDecision(db, g.decision.id, "approve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.punishmentId).toBeUndefined();
    expect(emits).toBe(1); // success → exactly one emit
    expect(Object.keys(store.getState().justice.punishments).length).toBe(0);
    expect(store.getState().personnelDecisions[g.decision.id]!.status).toBe("resolved");
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });

  it("approving a demotion memorial returns a punishmentId (PUNISH branch)", () => {
    const store = new GameStore();
    const base = tune(withConsort(createNewGameState(db, 1), db, "wenya"), WEN_OFFICIAL, { merit: 20 });
    const g = generateMemorial(base, db, WEN_OFFICIAL, "memorial_demotion", toGameTime(base.calendar))!;
    store.loadState(g.state);
    const r = store.resolvePersonnelDecision(db, g.decision.id, "approve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.punishmentId).toBeDefined();
    expect(store.getState().justice.punishments[r.value.punishmentId!]!.kind).toBe("official_demotion");
  });

  it("a failing resolution does not emit and leaves state byte-identical", () => {
    const store = new GameStore();
    const base = withConsort(createNewGameState(db, 1), db, "lu_huaijin");
    const g = generateConsortPetition(base, db, LU_CONSORT, toGameTime(base.calendar))!;
    store.loadState(g.state);
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const snap = JSON.stringify(store.getState());
    const r = store.resolvePersonnelDecision(db, g.decision.id, "demote"); // illegal for petition
    expect(r.ok).toBe(false);
    expect(emits).toBe(0); // failure → no emit
    expect(JSON.stringify(store.getState())).toBe(snap);
  });

  it("resolved decisions survive a save/load round-trip", () => {
    const store = new GameStore();
    const base = withConsort(createNewGameState(db, 1), db, "lu_huaijin");
    const g = generateConsortPetition(base, db, LU_CONSORT, toGameTime(base.calendar))!;
    store.loadState(g.state);
    store.resolvePersonnelDecision(db, g.decision.id, "approve");
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, store.getState(), "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.state.personnelDecisions).toEqual(store.getState().personnelDecisions);
  });
});

describe("save migration v17 → v18 (personnelDecisions backfill)", () => {
  it("SAVE_FORMAT_VERSION ≥ 18", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(18);
  });

  function makeV17Save(): string {
    const s = createNewGameState(db);
    const stateV17 = { ...s } as Record<string, unknown>;
    delete stateV17.personnelDecisions; // 旧档无此字段
    const env = { ...createSaveData(db, s, "slot1"), formatVersion: 17, state: stateV17, checksum: checksumOf(stateV17 as unknown as GameState) };
    return JSON.stringify(env);
  }

  it("v17 save without personnelDecisions migrates to v18 with an empty record", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV17Save());
    const loaded = readSlot(storage, db, "slot1", { now: () => 0 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.personnelDecisions).toEqual({});
  });
});
