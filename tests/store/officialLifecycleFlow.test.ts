/**
 * Phase 2 PR2A 完成标准：告老→批准→空缺→任命；死亡→dead→释放席位→保留家族/亲缘→
 * 宫中侍君仍能查到已故生母→不再被任免源选中。以及 approveRetirement/retainRetirement 命令。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { markOfficialDead } from "../../src/engine/officials/lifecycle";
import {
  getActiveSeatedOfficials,
  getOfficialRelativesOfConsort,
  isPostVacant,
} from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed");
const db = content.value;
const T = { year: 2, month: 1, period: "early" as const, dayIndex: 0 };

describe("retirement commands", () => {
  function storeWithPending(officialId: string) {
    const s = createNewGameState(db, 1);
    const store = new GameStore();
    store.loadState({ ...s, pendingRetirements: [{ officialId, requestedAt: T }] });
    return store;
  }

  it("approveRetirement → retired, seat released, pending consumed, history written", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    const store = storeWithPending(seated.id);
    const r = store.approveRetirement(seated.id);
    expect(r.ok).toBe(true);
    const after = store.getState();
    expect(after.officials[seated.id]!.status).toBe("retired");
    expect(after.officials[seated.id]!.postId).toBeNull();
    expect(after.pendingRetirements).toHaveLength(0);
    expect(after.officialHistory.some((h) => h.officialId === seated.id && h.status === "retired")).toBe(true);
    expect(isPostVacant(after, db, seated.postId!)).toBe(true);
  });

  it("retainRetirement → pending dropped, official stays active", () => {
    const s = createNewGameState(db, 1);
    const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
    const store = storeWithPending(seated.id);
    const r = store.retainRetirement(seated.id);
    expect(r.ok).toBe(true);
    expect(store.getState().pendingRetirements).toHaveLength(0);
    expect(store.getState().officials[seated.id]!.status).toBe("active");
  });

  it("approve/retain with no pending request errors", () => {
    const s = createNewGameState(db, 1);
    const store = new GameStore();
    store.loadState(s);
    const id = Object.keys(s.officials)[0]!;
    expect(store.approveRetirement(id).ok).toBe(false);
    expect(store.retainRetirement(id).ok).toBe(false);
  });
});

describe("completion flow: retire → vacancy → appoint another active official", () => {
  it("supports the full appointment cycle without exceeding seats", () => {
    const s = createNewGameState(db, 1);
    const a = Object.values(s.officials).find((o) => o.postId !== null && db.officialPosts[o.postId]!.seatCount === 1)!;
    const post = a.postId!;
    const store = new GameStore();
    store.loadState({ ...s, pendingRetirements: [{ officialId: a.id, requestedAt: T }] });

    // 批准告老 → 空缺
    expect(store.approveRetirement(a.id).ok).toBe(true);
    expect(isPostVacant(store.getState(), db, post)).toBe(true);

    // 取另一名在任官员，先罢免使其无职（active 可任用），再任命进空缺
    const b = Object.values(store.getState().officials).find((o) => o.status === "active" && o.postId !== null && o.id !== a.id)!;
    expect(store.assignOfficialPost(db, b.id, null).ok).toBe(true); // 卸任原职
    const appoint = store.assignOfficialPost(db, b.id, post);
    expect(appoint.ok).toBe(true);
    expect(store.getState().officials[b.id]!.postId).toBe(post);
    expect(isPostVacant(store.getState(), db, post)).toBe(false);
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);

    // 退休的 a 不能再被任命（非 active）
    expect(store.assignOfficialPost(db, a.id, "dianshi").ok).toBe(false);
  });
});

describe("completion flow: death keeps the person, releases the post", () => {
  it("dead mother still resolvable by her palace consort; excluded from active source", () => {
    const s = createNewGameState(db, 1);
    const motherId = "official_fam_shen_main";
    const post = s.officials[motherId]!.postId;
    const r = markOfficialDead(s, motherId, "natural_death", T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.value;

    expect(after.officials[motherId]).toBeDefined(); // not deleted
    expect(after.officials[motherId]!.status).toBe("dead");
    expect(after.officials[motherId]!.postId).toBeNull();
    if (post) expect(isPostVacant(after, db, post)).toBe(true);
    // 宫中侍君仍能查到已故生母
    expect(getOfficialRelativesOfConsort(after, "shen_zhibai").map((o) => o.id)).toContain(motherId);
    // 不再被任免源选中
    expect(getActiveSeatedOfficials(after, db).map((o) => o.id)).not.toContain(motherId);
    // 家族/亲缘仍在
    expect(after.officialFamilies["fam_shen_main"]).toBeDefined();
    expect(after.kinship.some((k) => k.toPersonId === motherId)).toBe(true);
    expect(validateOfficialWorld(after, db)).toEqual([]);
  });
});
