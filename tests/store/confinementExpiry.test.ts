import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { isConfined } from "../../src/engine/characters/confinement";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();

function freshStore() {
  const store = createGameStore();
  store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
  return store;
}

function expiredCount(state: GameState): number {
  return state.chronicle.filter((e) => e.payload.decree === "confinement_expired").length;
}

const tick = (store: ReturnType<typeof freshStore>) => store.advanceTime(db, { type: "SKIP_REMAINDER" });

describe("有期限禁足自动到期 sweep", () => {
  it("一个月(3旬)：T+1/T+2 仍禁足，T+3 旬开始自动解除", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(true);

    tick(store); // T+1
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(true);
    tick(store); // T+2 (到期前一旬仍禁足)
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(true);
    tick(store); // T+3 (到期旬开始解除)
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(false);
    expect(expiredCount(store.getState())).toBe(1);
  });

  it("自动解除只记录一次（继续推进不重复触发）", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
    for (let i = 0; i < 6; i++) tick(store); // 远超到期
    expect(expiredCount(store.getState())).toBe(1);
  });

  it("无诏不得出不会自动到期", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: null });
    for (let i = 0; i < 6; i++) tick(store);
    expect(isConfined(store.getState(), "lu_huaijin")).toBe(true);
    expect(expiredCount(store.getState())).toBe(0);
  });

  it("手动解除后不会再次自动解除（无期满记录）", () => {
    const store = freshStore();
    store.applyImperialCommand(db, { type: "impose_confinement", targetId: "lu_huaijin", durationTurns: 3 });
    store.applyImperialCommand(db, { type: "lift_confinement", targetId: "lu_huaijin" });
    for (let i = 0; i < 6; i++) tick(store);
    expect(expiredCount(store.getState())).toBe(0); // 已手动解除，不再期满
  });
});
