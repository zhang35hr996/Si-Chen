import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  exportSaveText,
  importSaveText,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createGameStore } from "../../src/store/gameStore";
import { isConfined, activeConfinement } from "../../src/engine/characters/confinement";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function storeWith(setup: (s: ReturnType<typeof createGameStore>) => void) {
  const store = createGameStore();
  store.loadState(createNewGameState(db));
  setup(store);
  return store;
}

describe("禁足存档兼容与 round-trip", () => {
  it("旧档（formatVersion 8）以 OBSOLETE_VERSION 拒绝，不隔离", () => {
    const storage = createMemoryStorage();
    const fresh = createSaveData(db, createNewGameState(db), "slot1");
    // 降级为 formatVersion 8（无 statusEffects）的存档。
    const oldState = { ...(fresh.state as unknown as Record<string, unknown>) };
    delete oldState["statusEffects"];
    const old = { ...fresh, formatVersion: 8, state: oldState, checksum: checksumOf(oldState) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(old));

    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    // Not quarantined — expected obsolete saves are not treated as corrupt.
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });

  it("有期限禁足保存/读取一致", () => {
    const store = storeWith((s) =>
      s.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 9 }),
    );
    const text = exportSaveText(db, store.getState());
    const loaded = importSaveText(db, text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const eff = activeConfinement(loaded.value.state, "lu_huaijin")!;
    const original = activeConfinement(store.getState(), "lu_huaijin")!;
    expect(eff.startTurn).toBe(original.startTurn);
    expect(eff.endTurnExclusive).toBe(original.endTurnExclusive);
    expect(isConfined(loaded.value.state, "lu_huaijin")).toBe(true);
  });

  it("无期限禁足保存/读取一致（endTurnExclusive null）", () => {
    const store = storeWith((s) =>
      s.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: null }),
    );
    const loaded = importSaveText(db, exportSaveText(db, store.getState()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(activeConfinement(loaded.value.state, "lu_huaijin")!.endTurnExclusive).toBeNull();
  });

  it("已解除的禁足不会重新生效", () => {
    const store = storeWith((s) => {
      s.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 9 });
      s.applyImperialCommand(db, { type: "lift_confinement", targetId: "lu_huaijin" });
    });
    const loaded = importSaveText(db, exportSaveText(db, store.getState()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(isConfined(loaded.value.state, "lu_huaijin")).toBe(false);
  });

  it("自动到期不因 reload 重复记录", () => {
    const store = storeWith((s) =>
      s.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 }),
    );
    for (let i = 0; i < 4; i++) store.advanceTime(db, { type: "SKIP_REMAINDER" }); // 越过到期
    const expiredBefore = store.getState().chronicle.filter((e) => e.payload.decree === "confinement_expired").length;
    expect(expiredBefore).toBe(1);

    // reload then advance again — 不得再记一次。
    const loaded = importSaveText(db, exportSaveText(db, store.getState()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store2 = createGameStore();
    store2.loadState(loaded.value.state);
    for (let i = 0; i < 4; i++) store2.advanceTime(db, { type: "SKIP_REMAINDER" });
    const expiredAfter = store2.getState().chronicle.filter((e) => e.payload.decree === "confinement_expired").length;
    expect(expiredAfter).toBe(1);
  });

  it("死亡状态 round-trip 正确（赐死后仍为已故）", () => {
    const store = storeWith((s) => s.applyImperialCommand(db, { type: "execute", targetId: "lu_huaijin" }));
    const loaded = importSaveText(db, exportSaveText(db, store.getState()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const st = loaded.value.state.standing.lu_huaijin!;
    expect(st.lifecycle).toBe("deceased");
    expect(st.deathRecord?.cause).toBe("imperial_execution");
  });
});
