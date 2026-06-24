/** PR2B 基础任免 store 命令：dismissOfficial / restoreOfficial（复用引擎服务，Result）。 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { isPostVacant } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function storeAt() {
  const s = createNewGameState(db, 1);
  const store = new GameStore();
  store.loadState(s);
  return store;
}

describe("GameStore.dismissOfficial", () => {
  it("罢免在任有职官员：仍 active、去职、开缺、写历史", () => {
    const store = storeAt();
    const seated = Object.values(store.getState().officials).find((o) => o.postId !== null)!;
    const post = seated.postId!;
    const r = store.dismissOfficial(seated.id);
    expect(r.ok).toBe(true);
    const o = store.getState().officials[seated.id]!;
    expect(o.status).toBe("active");
    expect(o.postId).toBeNull();
    expect(isPostVacant(store.getState(), db, post)).toBe(true);
    expect(store.getState().officialHistory.some((h) => h.officialId === seated.id && h.reason === "dismissal")).toBe(true);
  });

  it("罢免无职官员失败（OFFICIAL_NO_POST），state 不变", () => {
    const store = storeAt();
    const seated = Object.values(store.getState().officials).find((o) => o.postId !== null)!;
    store.dismissOfficial(seated.id); // 先去职
    const before = store.getState();
    const r = store.dismissOfficial(seated.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_NO_POST");
    expect(store.getState()).toBe(before);
  });
});

describe("GameStore.restoreOfficial", () => {
  it("起复非 active 官员 → active（postId 仍 null），随后可 assignOfficialPost", () => {
    const store = storeAt();
    const id = Object.keys(store.getState().officials)[0]!;
    // 构造一个 retired 官员
    store.loadState({
      ...store.getState(),
      officials: {
        ...store.getState().officials,
        [id]: { ...store.getState().officials[id]!, status: "retired", postId: null, statusReason: "retirement", statusChangedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } },
      },
    });
    const r = store.restoreOfficial(id);
    expect(r.ok).toBe(true);
    expect(store.getState().officials[id]!.status).toBe("active");
    expect(store.getState().officials[id]!.postId).toBeNull();
    expect(store.assignOfficialPost(db, id, "dianshi").ok).toBe(true);
  });

  it("起复 active 官员失败（OFFICIAL_BAD_TRANSITION）", () => {
    const store = storeAt();
    const id = Object.keys(store.getState().officials)[0]!;
    const r = store.restoreOfficial(id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_BAD_TRANSITION");
  });
});
